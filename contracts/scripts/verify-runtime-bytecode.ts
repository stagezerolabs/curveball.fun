type ImmutableReference = { start: number; length: number };

export type RuntimeArtifact = {
  deployedBytecode: {
    object: string;
    immutableReferences?: Record<string, ImmutableReference[]>;
  };
};

/** Compares the full runtime, ignoring only compiler-declared immutable value slots. */
export function matchesCompiledRuntime(
  liveHex: string,
  artifact: RuntimeArtifact,
): boolean {
  const compiledHex = artifact.deployedBytecode.object;
  if (
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(liveHex) ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(compiledHex)
  )
    return false;
  const live = Buffer.from(liveHex.slice(2), "hex");
  const compiled = Buffer.from(compiledHex.slice(2), "hex");
  if (live.length !== compiled.length) return false;
  for (const references of Object.values(
    artifact.deployedBytecode.immutableReferences ?? {},
  )) {
    for (const { start, length } of references) {
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(length) ||
        start < 0 ||
        length <= 0 ||
        start + length > live.length
      )
        return false;
      live.fill(0, start, start + length);
      compiled.fill(0, start, start + length);
    }
  }
  return live.equals(compiled);
}
