import { dashboardSessionPathSchema } from '@orqst/protocol';
import { appViews, viewFromHash, type AppView } from './shell-preferences';

export function viewFromLocation(
  location: Pick<Location, 'pathname' | 'hash'>,
): AppView | undefined {
  if (location.hash.startsWith('#session=')) return 'overview';
  return (
    viewFromHash(location.hash) ??
    (dashboardSessionPathSchema.safeParse(location.pathname).success ? 'overview' : undefined) ??
    appViews.find((view) => location.pathname === `/${view}`)
  );
}

export function viewPath(view: AppView, sessionId?: string): string {
  if (view !== 'overview' || !sessionId || sessionId.length > 200) return `/${view}`;
  try {
    const encoded = encodeURIComponent(sessionId);
    const path = `/overview/sessions/${encoded}`;
    // Keep historical identities that cannot safely be a path segment reloadable.
    return dashboardSessionPathSchema.safeParse(path).success
      ? path
      : `/overview#session=${encoded}`;
  } catch {
    // An invalid UTF-16 source identity has no lossless URL representation.
    return '/overview';
  }
}

const indexKey = 'orqstNavigationIndex';
function historyIndex(): number | undefined {
  const state: unknown = history.state;
  const index = state && typeof state === 'object' ? Reflect.get(state, indexKey) : undefined;
  return Number.isSafeInteger(index) && index >= 0 ? (index as number) : undefined;
}
function currentHref(): string {
  return location.pathname + location.search + location.hash;
}
function indexedState(index: number): Record<string, unknown> {
  const state: unknown = history.state;
  return { ...(state && typeof state === 'object' ? state : {}), [indexKey]: index };
}
interface Entry {
  href: string;
  index: number;
}

/** Restore traversal before asking the draft guard, preserving both history directions on cancel. */
export class DashboardHistory {
  private accepted: Entry = { href: currentHref(), index: historyIndex() ?? 0 };
  private restoring: (() => void) | undefined;
  private approved: Entry | undefined;

  constructor(
    private readonly guard: (href: string, action: () => void) => void,
    private readonly onTraverse: () => void,
  ) {
    history.replaceState(indexedState(this.accepted.index), '', this.accepted.href);
    window.addEventListener('popstate', this.traverse);
    window.addEventListener('hashchange', this.traverse);
  }

  dispose(): void {
    window.removeEventListener('popstate', this.traverse);
    window.removeEventListener('hashchange', this.traverse);
  }

  replace(href: string): void {
    this.accepted.href = href;
    history.replaceState(indexedState(this.accepted.index), '', href);
  }

  push(href: string): void {
    if (href === this.accepted.href) return;
    this.accepted = { href, index: this.accepted.index + 1 };
    history.pushState(indexedState(this.accepted.index), '', href);
  }

  private readonly traverse = (): void => {
    const href = currentHref();
    if (this.restoring) {
      if (href === this.accepted.href && historyIndex() === this.accepted.index) {
        const restored = this.restoring;
        this.restoring = undefined;
        restored();
      }
      return;
    }
    if (href === this.accepted.href && historyIndex() === this.accepted.index) return;
    // Native same-document hash links create entries without our index.
    const previousIndex = historyIndex();
    // Address-bar fragment navigation can copy the current entry's state. A new
    // href with that same index is a new entry, not a zero-distance traversal.
    const index =
      previousIndex === undefined || previousIndex === this.accepted.index
        ? this.accepted.index + 1
        : previousIndex;
    history.replaceState(indexedState(index), '', href);
    const target = { href, index };
    if (this.approved?.href === href && this.approved.index === index) {
      this.approved = undefined;
      this.accepted = target;
      this.onTraverse();
      return;
    }
    const delta = index - this.accepted.index;
    if (!delta) return;
    this.restoring = () => {
      this.guard(href, () => {
        this.approved = target;
        history.go(delta);
      });
    };
    history.go(-delta);
  };
}
