import test from 'node:test';
import assert from 'node:assert/strict';
import { formatProductModelName, parseProductModelName, neo75hModelName } from '../web/src/features/equipment/product-model.mjs';
import { createNeo75hProject, getNeo75hProfile } from '../web/src/profiles/neo75h.mjs';
import { parseProject, serializeProject } from '../web/src/core/model.mjs';

test('产品型号按系列、尺寸代号、减速机和两类传感器组成', () => {
  assert.equal(formatProductModelName({ series: 'NEO', size: 75, reducerType: 'H', encoder: 'GW', torqueSensor: 'KW' }), 'NEO_75_H_GW_KW');
  assert.deepEqual(parseProductModelName('NEO_75_H_GW_KW'), { name: 'NEO_75_H_GW_KW', series: 'NEO', size: '75', reducerType: 'H', reducerName: '谐波', encoder: 'GW', torqueSensor: 'KW' });
  assert.equal(parseProductModelName('NEO_75_E_GW_LD').reducerName, '行星');
  assert.equal(parseProductModelName('NEO_75_X_GW_KW'), null);
  assert.equal(parseProductModelName('NEO_75_H_GW_KW_EXTRA'), null);
});

test('四种型号名称一致，源工程文件仍使用原名称', () => {
  for (const variant of ['KW', 'LD', 'SMH', 'XH']) {
    const project = createNeo75hProject(variant), profile = getNeo75hProfile(variant);
    assert.equal(project.name, `NEO_75_H_GW_${variant}`);
    assert.equal(profile.name, neo75hModelName(variant));
    assert.equal(profile.model.encoder, 'GW');
    assert.equal(project.catalog.actuators[0].name, project.name);
    assert.equal(project.catalog.assemblies[0].name, project.name);
    assert.match(profile.sourceFile, /NEO_75H_(KW|LD|SMH)\.json$/);
    assert.deepEqual(parseProject(serializeProject(project)), project);
  }
});

test('首版仅接受规范型号标识，不迁移旧名称或用户自定义名称', () => {
  const project = createNeo75hProject('KW');
  project.name = '右膝关节'; project.catalog.actuators[0].name = '调试电机';
  const parsed = parseProject(JSON.stringify(project));
  assert.equal(parsed.name, '右膝关节'); assert.equal(parsed.catalog.actuators[0].name, '调试电机');
  project.instances['app-runtime'].parameters.hardwareProfile = 'neo75h_kw';
  assert.throws(() => parseProject(JSON.stringify(project)), /允许的选项/);
});
