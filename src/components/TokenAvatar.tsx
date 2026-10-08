import { useState } from "react";
import type { Token } from "../types";

export function TokenAvatar({
  token,
  className = "",
  index = 0,
}: {
  token: Token;
  className?: string;
  index?: number;
}) {
  const [failedSources, setFailedSources] = useState<Set<string>>(
    () => new Set(),
  );
  const generatedAvatar = `https://api.dicebear.com/10.x/loops/svg?seed=${encodeURIComponent(token.address)}`;
  const sources = [token.imageUrl, generatedAvatar].filter(
    (source): source is string => Boolean(source),
  );
  const source = sources.find((candidate) => !failedSources.has(candidate));

  if (source) {
    return (
      <img
        className={`token-avatar ${className}`.trim()}
        src={source}
        alt=""
        onError={() =>
          setFailedSources((current) => {
            const next = new Set(current);
            next.add(source);
            return next;
          })
        }
      />
    );
  }

  return (
    <span className={`token-avatar hue-${index % 4} ${className}`.trim()}>
      {(token.symbol || "?").slice(0, 1)}
    </span>
  );
}
