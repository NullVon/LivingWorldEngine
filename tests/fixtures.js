export const ids = ['ACTOR_PLAYER', 'ACTOR_1', 'ACTOR_2', 'OBJECT_1', 'LOCATION_1', 'LOCATION_2'];

export function base() {
  return ids.map(id => ({ id, ...(id.startsWith('ACTOR') ? { actor: { controller: id === 'ACTOR_PLAYER' ? 'Human' : 'Autonomous' }, primaryLocation: 'LOCATION_1' } : {}), ...(id === 'OBJECT_1' ? { primaryLocation: 'LOCATION_1' } : {}) }));
}

export function situation(extra = {}) {
  return { id: 'SITUATION_1', situation: {
    affected: ['OBJECT_1'], priority: 1, paths: [{ when: { entity: 'OBJECT_1', field: 'primaryLocation', op: 'eq', value: 'LOCATION_2' }, lifecycle: 'resolved' }], ...extra,
  } };
}

export function window(runtime, attempts = [], options = {}) {
  runtime.startScene(); attempts.forEach(a => runtime.submit(a)); return runtime.resolveScene(options);
}

export const claim = (subject = 'SITUATION_1', key = 'requested', value = 'LOCATION_2') => ({ subject, key, value });

export function acceptanceShell() {
  return {
    worldProcesses: ({ boundary }) => boundary === 1 ? [{ type: 'observed', effects: [{ type: 'learn', actor: 'ACTOR_1', claim: claim() }] }] : [],
    perceive: ({ event, world }) => {
      const a = event.event.attempt ? world.entities[event.event.attempt].attempt : null;
      if (event.event.type === 'action.resolved' && a?.type === 'Wait' && a.actor === 'ACTOR_PLAYER') {
        return [{ actor: 'ACTOR_1', claim: claim('ACTOR_PLAYER', 'response', 'Wait') }];
      }
      return [];
    },
    actions: {
      Move: {
        eligible: ({ attempt }) => attempt.targets.length === 1 && typeof attempt.params.location === 'string',
        resolve: ({ attempt }) => ({ effects: [
          { type: 'move', entity: attempt.targets[0], location: attempt.params.location },
          ...['ACTOR_1', 'ACTOR_2'].map(actor => ({ type: 'learn', actor, claim: claim(attempt.targets[0], 'primaryLocation', attempt.params.location) })),
        ] }),
      },
    },
    offscreenActors: () => ['ACTOR_1', 'ACTOR_2'],
    choices: ({ actor, view }) => {
      const known = view.find(e => e.claim.subject === 'SITUATION_1');
      if (!known) return [];
      if (actor.id === 'ACTOR_1') {
        const decline = view.find(e => e.claim.subject === 'ACTOR_PLAYER' && e.claim.value === 'Wait');
        return decline ? [{ weight: 1, attempt: { actor: actor.id, type: 'Communicate', situation: 'SITUATION_1', targets: ['ACTOR_2'], evidence: [known.id, decline.id], params: { claim: claim() } } }] : [];
      }
      return [{ weight: 1, attempt: { actor: actor.id, type: 'Move', situation: 'SITUATION_1', targets: ['OBJECT_1'], evidence: [known.id], params: { location: known.claim.value } } }];
    },
  };
}
