import type { Session } from "electron";

type PermissionGrant = { origin: string; permissions: readonly string[] };

/** Grants apply only to a main frame at an explicit HTTP(S) origin. */
export function configureSessionPermissions(
  session: Session,
  grants: readonly PermissionGrant[] = [],
): void {
  const allowed = (permission: string, origin: string, mainFrame: boolean): boolean => {
    if (!mainFrame) return false;
    try {
      const url = new URL(origin);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        grants.some(
          (grant) => grant.origin === url.origin && grant.permissions.includes(permission),
        )
      );
    } catch {
      return false;
    }
  };
  session.setPermissionCheckHandler((_contents, permission, origin, details) =>
    allowed(permission, origin, details.isMainFrame),
  );
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(allowed(permission, details.requestingUrl, details.isMainFrame));
  });
}
