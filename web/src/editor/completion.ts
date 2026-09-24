import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';

type TypeEntry = { type: string; displayName: string; provider: string };

/**
 * Completes the type in `resource "…"`, from the catalog: the types the
 * diagram knows how to draw, each with the name a person would use for it.
 * A learner should not need to know `aws_lb_target_group` by heart.
 */
export function resourceTypeCompletion(entries: readonly TypeEntry[]) {
  const options: Completion[] = entries.map((entry) => ({
    label: entry.type,
    detail: entry.displayName,
    info: `${entry.displayName} (${entry.provider})`,
    type: 'type',
  }));

  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const typed = /^\s*resource\s+"([a-z0-9_]*)$/.exec(before)?.[1];
    if (typed === undefined) return null;

    return { from: context.pos - typed.length, options, validFor: /^[a-z0-9_]*$/ };
  };
}
