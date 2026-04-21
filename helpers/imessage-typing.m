// bajaclaw-imessage-helper
// ------------------------
// Narrow Objective-C helper that calls Apple's private IMCore framework
// to toggle the "typing..." indicator on an iMessage thread. AppleScript
// doesn't expose setLocalUserIsTyping: and there's no public path to it;
// this binary dlopens IMCore, looks up IMChatRegistry, finds the chat,
// and invokes the selector via NSInvocation.
//
// Usage:
//   bajaclaw-imessage-helper start <handle-or-guid>
//   bajaclaw-imessage-helper stop  <handle-or-guid>
//
// Handle can be a phone number (E.164) or email. GUID can be the full
// chat guid (e.g. "iMessage;-;+15551234567") - we try both forms.
//
// Exit codes:
//   0  typing toggled
//   1  bad args
//   2  IMCore failed to load (framework path changed or TCC denied)
//   3  IMChatRegistry class not found (IMCore is loaded but symbol missing)
//   4  no chat found for the given handle (user must text first)
//   5  setLocalUserIsTyping: selector missing on IMChat
//   6  invocation failed (rare; caught and logged)
//
// Graceful-failure contract: any non-zero exit from this binary is
// treated as "typing unavailable" by the caller (src/channels/imessage.ts).
// The iMessage adapter never fails a send because of typing; it just
// skips the indicator and proceeds with the reply.
#import <Foundation/Foundation.h>
#import <dlfcn.h>

// Reverse-engineered private class declarations. Apple does not ship
// these headers; the symbols have been stable across macOS 10.14-15.
// If Apple renames any of these on a future macOS, this helper will
// fail with a clear exit code and the caller will skip typing.
@interface IMChatRegistry : NSObject
+ (instancetype)sharedInstance;
- (id)existingChatWithChatIdentifier:(NSString *)identifier;
- (id)existingChatForIMHandleID:(NSString *)handle;
@end

@interface IMChat : NSObject
- (void)setLocalUserIsTyping:(BOOL)typing;
- (NSString *)guid;
@end

static NSString * const IMCORE_PATH = @"/System/Library/PrivateFrameworks/IMCore.framework/IMCore";

static id findChat(id registry, NSString *target) {
    // Try the most specific form first - a full chat identifier like
    // "iMessage;-;+15551234567". If that fails, try the bare handle
    // (which may work against some older registry lookup paths).
    NSString *identifier = [NSString stringWithFormat:@"iMessage;-;%@", target];
    id chat = [registry performSelector:@selector(existingChatWithChatIdentifier:) withObject:identifier];
    if (chat) return chat;

    chat = [registry performSelector:@selector(existingChatWithChatIdentifier:) withObject:target];
    if (chat) return chat;

    // Last resort: lookup by handle directly (not all macOS versions
    // expose this selector; guarded by respondsToSelector:).
    SEL handleSel = @selector(existingChatForIMHandleID:);
    if ([registry respondsToSelector:handleSel]) {
        chat = [registry performSelector:handleSel withObject:target];
        if (chat) return chat;
    }
    return nil;
}

int main(int argc, char *argv[]) {
    @autoreleasepool {
        if (argc < 3) {
            fprintf(stderr, "usage: %s <start|stop> <handle-or-guid>\n", argv[0]);
            return 1;
        }

        const char *cmd = argv[1];
        BOOL typing;
        if (strcmp(cmd, "start") == 0) typing = YES;
        else if (strcmp(cmd, "stop") == 0) typing = NO;
        else {
            fprintf(stderr, "usage: %s <start|stop> <handle-or-guid>\n", argv[0]);
            return 1;
        }

        NSString *target = [NSString stringWithUTF8String:argv[2]];

        // dlopen the private framework. Without this, NSClassFromString
        // won't find IMChatRegistry because the framework isn't loaded
        // by default in a vanilla Foundation process.
        void *h = dlopen([IMCORE_PATH UTF8String], RTLD_NOW);
        if (!h) {
            fprintf(stderr, "ERROR: failed to load IMCore: %s\n", dlerror());
            return 2;
        }

        Class regClass = NSClassFromString(@"IMChatRegistry");
        if (!regClass) {
            fprintf(stderr, "ERROR: IMChatRegistry class not found (IMCore loaded but symbol missing)\n");
            return 3;
        }

        id registry = [regClass performSelector:@selector(sharedInstance)];
        if (!registry) {
            fprintf(stderr, "ERROR: [IMChatRegistry sharedInstance] returned nil\n");
            return 3;
        }

        id chat = findChat(registry, target);
        if (!chat) {
            fprintf(stderr, "ERROR: no existing chat for '%s' - user must text first\n", argv[2]);
            return 4;
        }

        SEL sel = @selector(setLocalUserIsTyping:);
        NSMethodSignature *sig = [chat methodSignatureForSelector:sel];
        if (!sig) {
            fprintf(stderr, "ERROR: setLocalUserIsTyping: not available on IMChat\n");
            return 5;
        }

        NSInvocation *inv = [NSInvocation invocationWithMethodSignature:sig];
        [inv setTarget:chat];
        [inv setSelector:sel];
        [inv setArgument:&typing atIndex:2];
        @try {
            [inv invoke];
        } @catch (NSException *e) {
            fprintf(stderr, "ERROR: invoke threw: %s\n", [[e reason] UTF8String] ?: "unknown");
            return 6;
        }

        fprintf(stdout, "ok\n");
        return 0;
    }
}
