/** The shape a path is read against — declared once, referred to everywhere, as a real app does. */
export interface Address {
  city: string;
  zip: string;
}

export interface Profile {
  name: string;
  address?: Address;
  nickname: string | null;
}

export interface AppState {
  /** ✗ optional, and paths walk through it. */
  profile?: Profile;
  /** ✗ a written `| null`. */
  settings: Settings | null;
  /** Present, so a path through it is fine. */
  account: Account;
  rows: Profile[];
  /** A generic instantiation: its members would be the declaration's, with the argument unsubstituted. */
  boxed: Box<Profile>;
}

export interface Box<T> {
  inner?: T;
}

export interface Settings {
  theme: string;
  layout?: Layout;
}

export interface Layout {
  columns: number;
}

export interface Account {
  id: string;
  owner: Profile;
}
