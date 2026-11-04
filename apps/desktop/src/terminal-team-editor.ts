import { terminalTeamSchema, type TerminalTeamState, type TerminalTeamSave } from '@orqst/protocol';

interface TeamReply {
  status: string;
  team?: TerminalTeamState;
  terminalIds?: string[];
}

/** Inert editor shared by native compositions. Never writes PTY text or activates a route. */
export function mountTerminalTeamEditor(
  container: HTMLElement,
  api: {
    read(): Promise<TeamReply>;
    save(input: TerminalTeamSave): Promise<TeamReply>;
    review?(slot: number, expectedRevision: number): Promise<unknown>;
  },
) {
  const t = (key: string) => container.dataset[key.toLowerCase()] ?? '';
  let revision = 0;
  let ids: string[] = [];
  let saving = false;
  let dirty = false;
  const reviews: HTMLButtonElement[] = [];
  const updateReviews = () =>
    reviews.forEach((button) => {
      button.disabled = saving || dirty || revision === 0;
    });
  const help = document.createElement('p');
  help.textContent = t('help');
  const form = document.createElement('form');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.dataset.teamStatus = 'true';
  const name = document.createElement('input');
  name.maxLength = 48;
  name.dataset.field = 'team-name';
  const label = (text: string, input: HTMLElement) => {
    const element = document.createElement('label');
    element.append(document.createTextNode(text + ' '), input);
    return element;
  };
  const members = document.createElement('div');
  const save = document.createElement('button');
  save.type = 'submit';
  save.dataset.action = 'save';
  save.textContent = t('save');
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.dataset.action = 'reload';
  reload.textContent = t('reload');
  const rows: Array<{
    name: HTMLInputElement;
    handle: HTMLInputElement;
    role: HTMLSelectElement;
    targets: HTMLInputElement[];
  }> = [];
  form.append(label(t('name'), name), members, save, reload);
  container.append(help, form, status);
  form.addEventListener('input', () => {
    dirty = true;
    updateReviews();
  });
  form.addEventListener('change', () => {
    dirty = true;
    updateReviews();
  });
  const operation = async (action: () => Promise<void>) => {
    if (saving) return;
    saving = true;
    // Disable every editor input during async reads/writes; no stale read may erase ongoing edits.
    form
      .querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
        'input,button,select',
      )
      .forEach((element) => {
        element.disabled = true;
      });
    status.textContent = t('working');
    try {
      await action();
    } catch {
      status.textContent = t('unavailable');
    } finally {
      saving = false;
      form
        .querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
          'input,button,select',
        )
        .forEach((element) => {
          element.disabled = false;
        });
      save.disabled = ids.length === 0;
      updateReviews();
    }
  };
  const load = (reply: TeamReply) => {
    if (reply.status !== 'ok' || !reply.team || !reply.terminalIds)
      throw new Error('Team unavailable');
    revision = reply.team.revision;
    ids = reply.terminalIds;
    name.value = reply.team.configuration?.name ?? t('defaultName');
    rows.length = 0;
    reviews.length = 0;
    dirty = false;
    members.replaceChildren();
    for (const [index, id] of ids.entries()) {
      const member = reply.team.configuration?.members.find((m) => m.terminalId === id);
      const section = document.createElement('fieldset');
      section.dataset.terminalId = id;
      const legend = document.createElement('legend');
      legend.textContent = id;
      const displayName = document.createElement('input');
      displayName.maxLength = 48;
      displayName.dataset.field = 'name';
      displayName.value = member?.name ?? `T-${String(index + 1).padStart(3, '0')}`;
      const handle = document.createElement('input');
      handle.maxLength = 32;
      handle.dataset.field = 'handle';
      handle.value = member?.handle ?? `terminal-${index + 1}`;
      const role = document.createElement('select');
      role.dataset.field = 'role';
      for (const value of ['worker', 'reviewer', 'orchestrator']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = t(value);
        role.append(option);
      }
      role.value = member?.role ?? 'worker';
      section.append(
        legend,
        label(t('memberName'), displayName),
        label(t('handle'), handle),
        label(t('role'), role),
      );
      const targets = ids
        .filter((target) => target !== id)
        .map((target) => {
          const check = document.createElement('input');
          check.type = 'checkbox';
          check.value = target;
          check.checked = member?.allowedTargetTerminalIds.includes(target) ?? false;
          section.append(label(`${t('targets')} ${target}`, check));
          return check;
        });
      if (api.review) {
        const review = document.createElement('button');
        review.type = 'button';
        review.dataset.action = 'review';
        review.textContent = t('review');
        review.onclick = () =>
          void operation(async () => {
            await api.review?.(index, revision);
            status.textContent = t('help');
          });
        reviews.push(review);
        section.append(review);
      }
      members.append(section);
      rows.push({ name: displayName, handle, role, targets });
    }
    status.textContent = t('help');
  };
  reload.onclick = () => void operation(async () => load(await api.read()));
  form.onsubmit = (event) => {
    event.preventDefault();
    void operation(async () => {
      const configuration = terminalTeamSchema.parse({
        version: 1,
        name: name.value,
        members: rows.map((row, index) => ({
          terminalId: ids[index],
          name: row.name.value,
          handle: row.handle.value,
          role: row.role.value,
          allowedTargetTerminalIds: row.targets
            .filter((target) => target.checked)
            .map((target) => target.value),
        })),
      });
      load(await api.save({ expectedRevision: revision, configuration }));
      status.textContent = t('saved');
    });
  };
  // Read only when explicitly requested; the native host retains current-document/focus checks.
  save.disabled = true;
  status.textContent = t('help');
}
