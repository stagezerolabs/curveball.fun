import { useState } from "react";

export function TokenAvatar({ token, className = "", index = 0 }) {
  const [failed, setFailed] = useState(false);

  if (token.imageUrl && !failed) {
    return (
      <img
        className={`token-avatar ${className}`.trim()}
        src={token.imageUrl}
        alt=""
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className={`token-avatar hue-${index % 4} ${className}`.trim()}>
      {(token.symbol || "?").slice(0, 1)}
    </span>
  );
}
