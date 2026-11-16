// Keep ownership checks independent of device presets and transport adapters.
const builtinRoles = [
  { prefix: 'motorEncoder', capability: 'encoderCapability', title: '角度编码器' },
  { prefix: 'outputEncoder', capability: 'outputEncoderCapability', title: '角度编码器（出轴侧）' },
  { prefix: 'torqueSensor', capability: 'torqueCapability', title: '力矩传感器' },
  { prefix: 'gateDriver', capability: 'gateDriverCapability', title: '门极驱动器' },
];
const configured = resource => typeof resource?.instance === 'string' && resource.instance.trim() && !['none', 'unselected', 'unconfirmed'].includes(resource.instance);
const samePort = (a, b) => a.kind === b.kind && a.instance === b.instance;

/** Explicit active bindings only; two resource records may name the same port. */
export function driverResourceUsers(parameters = {}, resources = []) {
  const users = [];
  const add = (reference, owner) => {
    const resource = resources.find(resource => resource.id === reference && configured(resource));
    if (resource) users.push({ ...owner, resourceId: resource.id, kind: resource.kind, instance: resource.instance });
  };
  for (const role of builtinRoles) {
    if (parameters[role.capability] !== 'present' || role.prefix === 'gateDriver' && parameters.gateDriverModel === 'discrete') continue;
    add(parameters[role.prefix+'Resource'], { prefix: role.prefix, title: role.title });
  }
  for (const driver of Array.isArray(parameters.customDrivers) ? parameters.customDrivers : []) {
    if (driver?.enabled !== true) continue;
    const title = (typeof driver.model === 'string' && driver.model.trim()) || (typeof driver.name === 'string' && driver.name.trim()) || '其他驱动';
    add(driver.resource, { customId: driver.id, title });
  }
  return users;
}

export function driverResourceOccupants(parameters, resources, resourceId, { prefix, customId } = {}) {
  const candidate = resources.find(resource => resource.id === resourceId && configured(resource));
  if (!candidate) return [];
  return driverResourceUsers(parameters, resources).filter(user => samePort(user, candidate) && !(prefix && user.prefix === prefix) && !(customId && user.customId === customId));
}

/** Imported duplicate bindings remain intact and produce a field error per owner. */
export function driverResourceConflictIssues(parameters, resources = []) {
  const users = driverResourceUsers(parameters, resources);
  return users.flatMap(user => {
    const peers = users.filter(other => other !== user && samePort(other, user));
    if (!peers.length) return [];
    const owners = [user, ...peers];
    return [{
      id: `hardware-${user.prefix || `custom-driver-${user.customId}`}-resource-choice`,
      code: 'driver-resource-conflict',
      code: 'driver-resource-conflict', level: 'error', title: '外设重复占用',
      message: `${user.instance} 同时被 ${owners.map(owner => owner.title).join('、')} 使用，请为每个驱动选择独立外设。`,
      messageParts: [
        { type: 'reference', label: user.instance, kind: 'peripheral' }, ' 同时被 ',
        ...owners.flatMap((owner, index) => [...(index ? ['、'] : []), { type: 'reference', label: owner.title, kind: 'driver' }]),
        ' 使用，请为每个驱动选择独立外设。',
      ],
      moduleId: 'hw-drivers', paramKey: user.prefix ? `${user.prefix}Resource` : 'customDrivers',
      ...(user.customId ? { itemId: user.customId } : {}),
    }];
  });
}
