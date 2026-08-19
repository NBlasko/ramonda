/** A props type declared somewhere else, which is the shape this repository actually writes. */
export interface ProfileProps {
  userId: string;
  theme: string;
}

/** An alias for a literal — readable the same way. */
export type BadgeProps = { count: number };

/** An intersection: its members are behind another type, so the rule must go quiet. */
export type MergedProps = { own: string } & ProfileProps;

/** An index signature makes every name a real prop. */
export interface OpenProps {
  [key: string]: unknown;
}
