import test from 'node:test';
import assert from 'node:assert/strict';
import { filterMajorMatches } from '../rank-results.js';

const matches = [
  { school: { name: '甲大学' }, major: { name: '电气工程及其自动化' }, lineScore: 507 },
  { school: { name: '电气大学' }, major: { name: '机械工程' }, lineScore: 500 },
  { school: { name: '乙大学' }, major: { name: '电气工程与智能控制（中外合作）' }, lineScore: 490 },
];

test('专业子串筛选保留结果顺序，不匹配学校名称', () => {
  assert.deepEqual(filterMajorMatches(matches, '电气'), [matches[0], matches[2]]);
  assert.equal(matches.length, 3);
});
test('空白关键词还原全部结果，去除关键词两端空白', () => {
  assert.deepEqual(filterMajorMatches(matches, '  '), matches);
  assert.deepEqual(filterMajorMatches(matches, ' 电气 '), [matches[0], matches[2]]);
});
test('大小写、全角字母和括号使用同一匹配规则', () => {
  const rows = [{ major: { name: 'AI工程（实验班）' } }];
  assert.deepEqual(filterMajorMatches(rows, 'ａｉ'), rows);
  assert.deepEqual(filterMajorMatches(rows, '(实验班)'), rows);
});
test('无匹配和空数据安全返回空数组', () => {
  assert.deepEqual(filterMajorMatches(matches, '不存在的专业'), []);
  assert.deepEqual(filterMajorMatches([], '电气'), []);
  assert.deepEqual(filterMajorMatches([{}], '电气'), []);
});
test('筛选包括第50条之后的专业，不受当前分页影响', () => {
  const rows = Array.from({ length: 576 }, (_, index) => ({ major: { name: index === 575 ? '电气工程' : '机械工程' } }));
  assert.deepEqual(filterMajorMatches(rows, '电气'), [rows[575]]);
});
