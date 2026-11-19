/** Reserve explicit and existing names before numbering the unnamed requests. */
export function defaultTerminalNames(
  names: readonly string[],
  requests: readonly { name: string; providerName: string }[],
): string[] {
  const normalize = (name: string) => name.trim().toLowerCase();
  const used = new Set([...names, ...requests.map(({ name }) => name)].map(normalize));
  return requests.map(({ name, providerName }) => {
    if (name.trim()) return name.trim();
    let ordinal = 1;
    while (used.has(normalize(`${providerName} ${ordinal}`))) ordinal++;
    const generated = `${providerName} ${ordinal}`;
    used.add(normalize(generated));
    return generated;
  });
}
