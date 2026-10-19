const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const REPORT_REASONS = new Set(["spam", "impersonation", "manipulation", "harmful_content", "other"]);
const NOTIFICATION_KINDS = new Set([
  "followed_buy", "followed_sell", "new_follower", "curve_milestone", "graduation", "reaction",
]);

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

function record(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object.`);
  return value;
}

export function parseFollowingPeriod(value) {
  if (value == null || value === "") return "1h";
  if (value === "1h" || value === "24h") return value;
  return invalid("Choose a supported Following period.");
}

export function parseProfileUpdate(value) {
  const body = record(value, "Profile");
  if (typeof body.displayName !== "string" || body.displayName.trim().length > 40 ||
    body.displayName.trim().length === 1 ||
    typeof body.bio !== "string" || body.bio.trim().length > 280 ||
    typeof body.discoverable !== "boolean") invalid("Profile fields are invalid.");
  return { displayName: body.displayName.trim(), bio: body.bio.trim(), discoverable: body.discoverable };
}

export function parseReportBody(value) {
  const body = record(value, "Report");
  if (typeof body.subjectAddress !== "string" || !ADDRESS.test(body.subjectAddress) ||
    !REPORT_REASONS.has(body.reason) ||
    (body.details != null && (typeof body.details !== "string" || body.details.length > 1000)) ||
    (body.tradeId != null && (typeof body.tradeId !== "string" || !body.tradeId || body.tradeId.length > 256))) {
    invalid("Report fields are invalid.");
  }
  return {
    subjectAddress: body.subjectAddress.toLowerCase(),
    reason: body.reason,
    details: body.details || "",
    tradeId: body.tradeId || null,
  };
}

export function parseNotificationPreferencesPatch(value) {
  const body = record(value, "Notification preferences");
  const keys = ["inApp", "tradeBuys", "tradeSells", "graduations", "newFollowers"];
  if (!keys.some((key) => key in body) ||
    Object.keys(body).some((key) => !keys.includes(key)) ||
    keys.some((key) => key in body && typeof body[key] !== "boolean")) {
    invalid("Notification preferences must contain boolean settings.");
  }
  return Object.fromEntries(keys.filter((key) => key in body).map((key) => [key, body[key]]));
}

export function assertPageResponse(value) {
  const page = record(value, "Page");
  if (!Array.isArray(page.items) || !(page.nextCursor === null || typeof page.nextCursor === "string")) {
    invalid("Page response is invalid.");
  }
  return page;
}

export function assertFollowingBuysResponse(value) {
  const result = record(value, "Following buys response");
  if (result.scope !== "following" || !["1h", "24h"].includes(result.period) || !Array.isArray(result.items) ||
    result.items.some((item) => !ADDRESS.test(item?.tokenAddress) || !Array.isArray(item?.buyers) ||
      item.buyers.some((buyer) => !ADDRESS.test(buyer?.address)))) {
    invalid("Following buys response is invalid.");
  }
  return result;
}

export function assertNotificationsResponse(value) {
  const result = assertPageResponse(value);
  if (!Number.isSafeInteger(result.unreadCount) || result.unreadCount < 0 ||
    result.items.some((item) => !NOTIFICATION_KINDS.has(item?.kind) ||
      !(typeof item?.id === "string" || typeof item?.id === "number") ||
      !item?.payload || typeof item.payload !== "object")) {
    invalid("Notifications response is invalid.");
  }
  return result;
}
