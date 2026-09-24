/** "1 resource", "3 resources". English only, like the rest of the interface. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
