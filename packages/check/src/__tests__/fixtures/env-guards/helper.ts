/** A plain module function. Nothing about it says which side runs it. */
export function fromHelper(): string {
  return process.env.API_BASE ?? "";
}
