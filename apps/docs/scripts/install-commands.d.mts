/** One install fence, written for each package manager: `[manager, commands]` pairs. */
export function installCommands(text: string, where: string): [string, string][];
