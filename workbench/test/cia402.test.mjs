import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject } from '../web/src/core/model.mjs';
import { CIA402_MODES, CIA402_STATES, getCia402Design, validateCia402 } from '../web/src/modules/application/app-state/cia402.mjs';

function fixture() {
  const project = createProject();
  Object.assign(project.instances['app-state'].parameters, { stateMachine: 'cia402', cia402Modes: ['csp'], cia402DefaultMode: 'none' });
  project.instances['app-comms'].enabled = project.instances['app-comms'].runtimeEnabled = true;
  project.instances['app-motion'].parameters.supportedModes = ['position'];
  return project;
}

test('standard codes and the source vendor extensions are distinguished', () => {
  assert.deepEqual(CIA402_MODES.filter(mode => mode.standard).map(mode => mode.code), [1, 3, 4, 6, 8, 9, 10]);
  assert.equal(CIA402_MODES.find(mode => mode.value === 'csc').code, -10);
  assert.equal(CIA402_MODES.find(mode => mode.value === 'pd').standard, false);
  assert.equal(CIA402_MODES.find(mode => mode.value === 'cst').firmwareEnum, 'CIA402_MODE_CST');
  assert.equal(CIA402_STATES.length, 8);
});

test('CiA 402 design returns detached state and mode descriptions', () => {
  const project = fixture(), design = getCia402Design(project);
  assert.equal(design.enabled, true);
  assert.equal(design.defaultMode, null);
  assert.equal(design.modes[0].code, 8);
  design.states[0].label = 'changed';
  assert.notEqual(getCia402Design(project).states[0].label, 'changed');
  assert.deepEqual(design.objects.map(object => object.index), [0x6040, 0x6041, 0x6060, 0x6061]);
});

test('configuration requires compiled default mode and its control capability', () => {
  const project = fixture();
  project.instances['app-state'].parameters.cia402DefaultMode = 'cst';
  assert(validateCia402(project).some(issue => issue.id === 'cia402-default-not-compiled'));
  project.instances['app-state'].parameters.cia402Modes = ['cst'];
  assert(validateCia402(project).some(issue => issue.id === 'cia402-motion-cst'));
  // The CiA 402 torque mode itself does not require an external torque transducer.
  project.instances['app-motion'].parameters.supportedModes.push('current');
  assert.equal(validateCia402(project).filter(issue => issue.level === 'error').length, 0);
});

test('profile mode requires positive slopes and windows but cyclic modes do not', () => {
  const project = fixture();
  assert(!validateCia402(project).some(issue => issue.id.startsWith('cia402-profile-')));
  project.instances['app-state'].parameters.cia402Modes = ['pp'];
  assert(validateCia402(project).some(issue => issue.id === 'cia402-profile-missing-profileVelocityRadS'));
  project.instances['app-motion'].parameters.profileAccelerationRadS2 = 0;
  assert(validateCia402(project).some(issue => issue.id === 'cia402-profile-range-profileAccelerationRadS2'));
});

test('disabled communication cannot supply a running state machine', () => {
  const project = fixture();
  project.instances['app-comms'].runtimeEnabled = false;
  assert(validateCia402(project).some(issue => issue.id === 'cia402-dependency-app-comms'));
  project.instances['app-state'].parameters.stateMachine = 'local';
  assert.deepEqual(validateCia402(project), []);
});

test('older projects gain inert CiA 402 defaults without changing the existing scheduler', () => {
  const project = createProject();
  project.instances['app-runtime'].parameters = { scheduler: 'cooperative' };
  const migrated = parseProject(serializeProject(project));
  assert.equal(migrated.instances['app-runtime'].parameters.scheduler, 'cooperative');
  assert.equal(migrated.instances['app-state'].parameters.stateMachine, 'unselected');
  assert.deepEqual(migrated.instances['app-state'].parameters.cia402Modes, []);
});
