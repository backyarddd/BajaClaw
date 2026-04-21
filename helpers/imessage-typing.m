// bajaclaw-imessage-helper
// ------------------------
// Long-running Obj-C helper that keeps a live connection to Apple's
// imagent via IMDaemonController, maintains the IMChatRegistry cache
// in-process, and toggles the "..." typing indicator on iMessage
// threads via the private IMCore framework.
//
// Why long-running: imagent pushes chat state asynchronously to any
// process that has registered as an IMDaemonListener. A short-lived
// one-shot helper exits before that state arrives, so the registry
// always looks empty. Keeping one helper per daemon lifetime lets us
// amortize the startup cost and always have a populated registry.
//
// Protocol: the helper reads newline-delimited commands from stdin
// and writes newline-delimited responses to stdout.
//
//   start <handle-or-guid>   -> "ok" | "err <reason>"
//   stop  <handle-or-guid>   -> "ok" | "err <reason>"
//   ping                     -> "ok"
//   quit                     -> exits 0
//
// Arg-style legacy mode is also supported so existing callers and
// unit tests keep working: invoking with `<verb> <handle>` as argv
// performs a single toggle and exits. In that mode we wait up to
// 5s for the registry to populate (shorter than the long-running
// path would need, because a single ask can give up).
//
// Graceful-failure contract: any non-zero exit or "err <reason>"
// line means "typing unavailable for this call". The Node adapter
// never fails a send because of typing.
#import <Foundation/Foundation.h>
#import <dlfcn.h>

// Reverse-engineered private class declarations. Apple does not ship
// these headers; symbols have been stable across macOS 10.14-15.
@interface IMDaemonController : NSObject
+ (instancetype)sharedInstance;
- (BOOL)connectToDaemon;
- (BOOL)blockUntilConnected;
- (id)listener;
@end

@interface IMChatRegistry : NSObject
+ (instancetype)sharedInstance;
- (id)existingChatWithChatIdentifier:(NSString *)identifier;
- (id)existingChatWithGUID:(NSString *)guid;
- (id)_existingChatWithGUID:(NSString *)guid;
- (NSArray *)allExistingChats;
@end

@interface IMChat : NSObject
- (void)setLocalUserIsTyping:(BOOL)typing;
- (NSString *)guid;
- (NSString *)chatIdentifier;
@end

// Listener class. Registered with imagent so it pushes chat state
// to this process. Without this registration, IMChatRegistry stays
// empty even after a successful connectToDaemon + blockUntilConnected.
//
// Key insight from BlueBubbles: imagent only delivers chat state to
// processes registered via [[daemon listener] addHandler:] with an
// appropriate capabilities bitmask.
@interface BajaCrawListener : NSObject
@end

static NSString * const IMCORE_PATH = @"/System/Library/PrivateFrameworks/IMCore.framework/IMCore";
static BOOL gVerbose = NO;
// Set to YES by listener callbacks once imagent has pushed at least
// the initial chat state. Used as an early-exit signal in waitForChats.
static BOOL gReady = NO;
// Kept alive for process lifetime; ARC retains through this global.
static id gListenerInstance = nil;

static void logDebug(NSString *fmt, ...) {
    if (!gVerbose) return;
    va_list args;
    va_start(args, fmt);
    NSString *s = [[NSString alloc] initWithFormat:fmt arguments:args];
    va_end(args);
    fprintf(stderr, "DEBUG: %s\n", [s UTF8String]);
}

@implementation BajaCrawListener

// imagent calls setupComplete: / setupCompleted: when the connection
// handshake finishes. Either name can appear depending on macOS version.
- (void)setupComplete:(id)arg {
    logDebug(@"setupComplete:");
    gReady = YES;
}
- (void)setupCompleted:(id)arg {
    logDebug(@"setupCompleted:");
    gReady = YES;
}
- (void)didConnectToIMAgent:(id)arg {
    logDebug(@"didConnectToIMAgent:");
    gReady = YES;
}

// imagent calls these when chat state becomes available.
- (void)chatLoaded:(id)arg1 chatProperties:(id)arg2 {
    logDebug(@"chatLoaded:chatProperties:");
    gReady = YES;
}
- (void)chatsDidChange:(id)arg1 {
    logDebug(@"chatsDidChange:");
    gReady = YES;
}
- (void)chatsLoaded:(id)arg1 {
    logDebug(@"chatsLoaded:");
    gReady = YES;
}

// No-op stubs for other common imagent callbacks.
- (void)messageReceived:(id)arg1 { }
- (void)account:(id)arg1 updatedSettings:(id)arg2 { }
- (void)account:(id)arg1 status:(id)arg2 { }
- (void)account:(id)arg1 loginStatusChanged:(id)arg2 { }
- (void)didDisconnectFromIMAgent:(id)arg1 { }

// imagent queries capabilities to decide which events to push.
// Return all bits so we receive chat list and setup events.
- (unsigned long long)capabilities {
    return 0xFFFFFFFFFFFFFFFFULL;
}

// Safe fallback: imagent sends many selectors we haven't declared.
// Without methodSignatureForSelector: + forwardInvocation:, any
// unknown selector would crash with "unrecognized selector".
- (NSMethodSignature *)methodSignatureForSelector:(SEL)sel {
    NSMethodSignature *sig = [super methodSignatureForSelector:sel];
    if (!sig) {
        // Generic void(id) signature covers the vast majority of
        // imagent callbacks that deliver a single object argument.
        sig = [NSMethodSignature signatureWithObjCTypes:"v@:@"];
    }
    return sig;
}
- (void)forwardInvocation:(NSInvocation *)inv {
    NSString *selName = NSStringFromSelector([inv selector]);
    logDebug(@"unhandled imagent callback: %@", selName);
    // Treat any "chat"/"setup"/"chats" prefixed callback as a ready
    // signal - imagent may rename these methods across macOS versions.
    if ([selName hasPrefix:@"chat"]
     || [selName hasPrefix:@"setup"]
     || [selName hasPrefix:@"chats"]
     || [selName hasPrefix:@"didConnect"]) {
        gReady = YES;
    }
}

@end

static BOOL loadIMCore(void) {
    void *h = dlopen([IMCORE_PATH UTF8String], RTLD_NOW);
    if (!h) {
        fprintf(stderr, "ERROR: failed to load IMCore: %s\n", dlerror());
        return NO;
    }
    return YES;
}

static BOOL connectDaemon(void) {
    Class daemonClass = NSClassFromString(@"IMDaemonController");
    if (!daemonClass) return NO;
    id daemon = [daemonClass performSelector:@selector(sharedInstance)];
    if (!daemon) return NO;

    // Create the listener before connecting so it is ready when imagent
    // delivers the initial connection callbacks.
    gListenerInstance = [[BajaCrawListener alloc] init];

    if ([daemon respondsToSelector:@selector(connectToDaemon)]) {
        [daemon performSelector:@selector(connectToDaemon)];
    }
    if ([daemon respondsToSelector:@selector(blockUntilConnected)]) {
        [daemon performSelector:@selector(blockUntilConnected)];
    }

    // Register as a listener. imagent will begin pushing chat state
    // once the handler is added with appropriate capabilities.
    // Primary path: [[daemon listener] addHandler:]
    id daemonListener = [daemon respondsToSelector:@selector(listener)]
        ? [daemon performSelector:@selector(listener)] : nil;

    SEL addHandlerSel = NSSelectorFromString(@"addHandler:");
    if (daemonListener && [daemonListener respondsToSelector:addHandlerSel]) {
        // Dynamic selector: ARC warns about potential leak but gListenerInstance
        // is a strong global so there is no actual leak.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
        [daemonListener performSelector:addHandlerSel withObject:gListenerInstance];
#pragma clang diagnostic pop
        logDebug(@"listener registered via [daemonListener addHandler:]");
    } else {
        // Fallback: some macOS versions expose addListener: on the daemon itself.
        SEL addListenerSel = NSSelectorFromString(@"addListener:");
        if ([daemon respondsToSelector:addListenerSel]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
            [daemon performSelector:addListenerSel withObject:gListenerInstance];
#pragma clang diagnostic pop
            logDebug(@"listener registered via [daemon addListener:]");
        } else {
            logDebug(@"WARNING: no listener registration API found - chat list may not load");
        }
    }

    return YES;
}

// Wait up to `seconds` for the registry to report at least one chat.
// Now also watches gReady (set by listener callbacks) as an early exit.
// Returns the chat count when it gives up (may be 0 on timeout).
static NSUInteger waitForChats(NSTimeInterval seconds) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:seconds];
    NSUInteger last = 0;
    while ([[NSDate date] compare:deadline] == NSOrderedAscending) {
        @autoreleasepool {
            [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
            Class rc = NSClassFromString(@"IMChatRegistry");
            id reg = [rc performSelector:@selector(sharedInstance)];
            id chats = [reg performSelector:@selector(allExistingChats)];
            if ([chats isKindOfClass:[NSArray class]]) {
                last = [(NSArray *)chats count];
                if (last > 0) return last;
            }
            // gReady means the listener received a chat-state callback.
            // Give the registry one extra tick to settle, then return
            // whatever we have (even if count is still 0 - some macOS
            // versions populate via chatIdentifier lookup only).
            if (gReady) {
                [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.3]];
                id chats2 = [reg performSelector:@selector(allExistingChats)];
                if ([chats2 isKindOfClass:[NSArray class]]) {
                    last = [(NSArray *)chats2 count];
                }
                return last;
            }
        }
    }
    return last;
}

static id findChat(NSString *target) {
    Class rc = NSClassFromString(@"IMChatRegistry");
    id registry = [rc performSelector:@selector(sharedInstance)];

    NSArray<NSString *> *guids = @[
        [NSString stringWithFormat:@"any;-;%@", target],
        [NSString stringWithFormat:@"iMessage;-;%@", target],
        [NSString stringWithFormat:@"SMS;-;%@", target],
    ];

    // Strategy 1: enumerate allExistingChats and match by
    // chatIdentifier or guid tail. Works once imagent has pushed state.
    if ([registry respondsToSelector:@selector(allExistingChats)]) {
        id allChats = [registry performSelector:@selector(allExistingChats)];
        if ([allChats isKindOfClass:[NSArray class]]) {
            logDebug(@"allExistingChats -> %lu chats", (unsigned long)[(NSArray *)allChats count]);
            for (id chat in (NSArray *)allChats) {
                NSString *cid = [chat respondsToSelector:@selector(chatIdentifier)]
                    ? [chat performSelector:@selector(chatIdentifier)] : nil;
                NSString *cguid = [chat respondsToSelector:@selector(guid)]
                    ? [chat performSelector:@selector(guid)] : nil;
                if ([cid isEqualToString:target]) return chat;
                if (cguid) {
                    for (NSString *g in guids) if ([cguid isEqualToString:g]) return chat;
                    if ([cguid hasSuffix:[NSString stringWithFormat:@";-;%@", target]]) return chat;
                }
            }
        }
    }

    // Strategy 2: direct GUID lookup on the registry.
    for (NSString *guid in guids) {
        id chat = [registry performSelector:@selector(existingChatWithChatIdentifier:) withObject:guid];
        if (chat) return chat;
        if ([registry respondsToSelector:@selector(_existingChatWithGUID:)]) {
            chat = [registry performSelector:@selector(_existingChatWithGUID:) withObject:guid];
            if (chat) return chat;
        }
    }

    // Strategy 3: bare handle.
    return [registry performSelector:@selector(existingChatWithChatIdentifier:) withObject:target];
}

// Perform typing toggle; return nil on success or an error string.
static NSString *toggleTyping(NSString *target, BOOL typing) {
    id chat = findChat(target);
    if (!chat) return @"no existing chat (user must text first)";
    SEL sel = @selector(setLocalUserIsTyping:);
    NSMethodSignature *sig = [chat methodSignatureForSelector:sel];
    if (!sig) return @"setLocalUserIsTyping: not available";
    NSInvocation *inv = [NSInvocation invocationWithMethodSignature:sig];
    [inv setTarget:chat];
    [inv setSelector:sel];
    [inv setArgument:&typing atIndex:2];
    @try {
        [inv invoke];
    } @catch (NSException *e) {
        return [NSString stringWithFormat:@"invoke threw: %@", [e reason]];
    }
    return nil;
}

// Long-running stdin loop. Reads commands on a GCD background thread
// so the main thread can keep spinning NSRunLoop, which is required
// for imagent to deliver callbacks to gListenerInstance.
//
// Commands are dispatched back to the main thread for toggleTyping
// because IMCore is not thread-safe.
static int runDaemonLoop(void) {
    logDebug(@"entering daemon loop");
    setvbuf(stdout, NULL, _IOLBF, 0);

    __block volatile BOOL done = NO;

    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        char *buf = NULL;
        size_t bufSize = 0;
        ssize_t len;
        while (!done && (len = getline(&buf, &bufSize, stdin)) != -1) {
            @autoreleasepool {
                while (len > 0 && (buf[len-1] == '\n' || buf[len-1] == '\r')) { buf[--len] = '\0'; }
                if (len == 0) continue;
                NSString *line = [NSString stringWithUTF8String:buf];
                NSArray<NSString *> *parts = [line componentsSeparatedByString:@" "];
                NSString *cmd = parts.count > 0 ? parts[0] : @"";
                NSString *arg = parts.count > 1
                    ? [[parts subarrayWithRange:NSMakeRange(1, parts.count - 1)] componentsJoinedByString:@" "]
                    : @"";

                if ([cmd isEqualToString:@"ping"]) {
                    printf("ok\n");
                } else if ([cmd isEqualToString:@"quit"]) {
                    printf("ok\n");
                    done = YES;
                    break;
                } else if ([cmd isEqualToString:@"start"] || [cmd isEqualToString:@"stop"]) {
                    BOOL typing = [cmd isEqualToString:@"start"];
                    __block NSString *err = nil;
                    // Dispatch to main thread: IMCore callbacks and toggleTyping
                    // must run on the same thread as the runloop.
                    dispatch_sync(dispatch_get_main_queue(), ^{
                        err = toggleTyping(arg, typing);
                    });
                    if (err) {
                        printf("err %s\n", [err UTF8String]);
                    } else {
                        printf("ok\n");
                    }
                } else {
                    printf("err unknown command\n");
                }
            }
        }
        free(buf);
        done = YES;
        dispatch_async(dispatch_get_main_queue(), ^{
            CFRunLoopStop(CFRunLoopGetMain());
        });
    });

    // Spin the main runloop indefinitely. This is what keeps imagent
    // able to fire callbacks on gListenerInstance. Without this, the
    // listener is registered but never invoked.
    while (!done) {
        @autoreleasepool {
            [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1.0]];
        }
    }
    return 0;
}

int main(int argc, char *argv[]) {
    @autoreleasepool {
        gVerbose = getenv("BAJACLAW_HELPER_DEBUG") != NULL;

        if (!loadIMCore()) return 2;
        if (!connectDaemon()) {
            fprintf(stderr, "ERROR: IMDaemonController not available\n");
            return 3;
        }

        // Two modes:
        //   argv form (legacy):  helper <start|stop> <handle>
        //   daemon form:         helper serve  (reads stdin)
        if (argc >= 2 && strcmp(argv[1], "serve") == 0) {
            return runDaemonLoop();
        }

        if (argc < 3) {
            fprintf(stderr, "usage: %s <start|stop|serve> [handle]\n", argv[0]);
            return 1;
        }

        const char *cmd = argv[1];
        BOOL typing;
        if (strcmp(cmd, "start") == 0) typing = YES;
        else if (strcmp(cmd, "stop") == 0) typing = NO;
        else {
            fprintf(stderr, "usage: %s <start|stop|serve> [handle]\n", argv[0]);
            return 1;
        }

        NSString *target = [NSString stringWithUTF8String:argv[2]];

        // One-shot mode: wait up to 5s for registry. The listener registered
        // in connectDaemon() will receive callbacks while the runloop spins
        // inside waitForChats(), which now exits early when gReady is set.
        waitForChats(5.0);

        NSString *err = toggleTyping(target, typing);
        if (err) {
            fprintf(stderr, "ERROR: %s\n", [err UTF8String]);
            return 4;
        }

        fprintf(stdout, "ok\n");
        return 0;
    }
}
