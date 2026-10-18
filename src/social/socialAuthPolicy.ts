export type SocialAuthAction = "confirm" | "loading" | "login" | "await-wallet";

export function selectSocialAuthAction({
  ready,
  authenticated,
  hasAddress,
}: {
  ready: boolean;
  authenticated: boolean;
  hasAddress: boolean;
}): SocialAuthAction {
  if (ready && authenticated && hasAddress) return "confirm";
  if (ready && authenticated) return "await-wallet";
  if (!ready) return "loading";
  return "login";
}

type PendingRequest<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

export function createSocialAuthRequestGate<T>() {
  let pending: PendingRequest<T> | null = null;

  return {
    request(start?: () => void) {
      if (pending) return pending.promise;

      let resolveRequest!: (value: T) => void;
      let rejectRequest!: (error: Error) => void;
      const promise = new Promise<T>((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      pending = {
        promise,
        resolve: (value) => {
          pending = null;
          resolveRequest(value);
        },
        reject: (error) => {
          pending = null;
          rejectRequest(error);
        },
      };

      try {
        start?.();
      } catch (cause) {
        pending.reject(cause instanceof Error ? cause : new Error("Sign in could not be started."));
      }
      return promise;
    },
    resolve(value: T) {
      pending?.resolve(value);
    },
    reject(error: Error) {
      pending?.reject(error);
    },
    hasPendingRequest() {
      return Boolean(pending);
    },
  };
}
