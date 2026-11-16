/** Disclosure is a workspace preference, never part of generated configuration. */
export function createConfigurationTreeState({ storage, key = 'abd-foc.engineering-tree' } = {}) {
  let states = {};
  let initialized = false, revealed = new Set();
  const applied = new WeakMap();
  try {
    const saved = JSON.parse(storage?.getItem(key) || '{}');
    if (saved && !Array.isArray(saved) && typeof saved === 'object') states = Object.fromEntries(Object.entries(saved).filter(([id,value])=>id.startsWith('tree-') && typeof value === 'boolean'));
  } catch {}
  const save = () => { try { storage?.setItem(key,JSON.stringify(states)); } catch {} };
  return {
    capture(root) {
      const branches = root.querySelectorAll('.configuration-tree details[data-tree-branch]');
      if (!branches.length) return;
      // Only explicit disclosure changes are preferences. Auto-revealed ancestors
      // must not accumulate as permanently open branches while browsing modules.
      for (const branch of branches) if (applied.has(branch) && applied.get(branch) !== branch.open) {
        states[branch.dataset.stateKey] = branch.open;
        revealed.delete(branch.dataset.stateKey);
        applied.set(branch, branch.open);
      }
      save();
    },
    restore(root,{stepId='',moduleId='',reveal=false}={}) {
      const branches = root.querySelectorAll('.configuration-tree details[data-tree-branch]');
      if (!branches.length) return;
      if (reveal || !initialized) {
        revealed = new Set();
        const selected = [...root.querySelectorAll(moduleId?'[data-tree-module]':'[data-tree-step]')].find(node=>moduleId?node.dataset.treeModule===moduleId:node.dataset.treeStep===stepId);
        for (let branch=selected?.closest('details'); branch; branch=branch.parentElement?.closest('details')) {
          if (!branch.hasAttribute('data-tree-branch')) break;
          const id = branch.dataset.stateKey;
          if (reveal || !Object.hasOwn(states,id)) revealed.add(id);
        }
        initialized = true;
      }
      for (const branch of branches) {
        branch.open = revealed.has(branch.dataset.stateKey) || states[branch.dataset.stateKey] === true;
        applied.set(branch,branch.open);
      }
    },
  };
}
