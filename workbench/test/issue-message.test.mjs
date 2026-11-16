import test from 'node:test';
import assert from 'node:assert/strict';
import { renderIssueMessage, sanitizeIssueMessageParts } from '../web/src/shared/ui/issue-message.mjs';

const reference=(label,kind='driver')=>({type:'reference',label,kind});

test('issue references render as inline tags while keeping the sentence text intact', () => {
  const message='UART4 同时被 角度编码器、力矩传感器 使用。';
  const html=renderIssueMessage({message,messageParts:[reference('UART4','peripheral'),' 同时被 ',reference('角度编码器'),'、',reference('力矩传感器'),' 使用。']});
  assert.equal((html.match(/class="attribute-tag issue-reference-tag"/g)||[]).length,3);
  assert.equal(html.replace(/<[^>]+>/g,''),message);
  assert.doesNotMatch(html,/<button|<a |<details/);
});

test('both ordinary text and reference labels are escaped rather than interpreted as markup', () => {
  const html=renderIssueMessage({messageParts:['<b>& ',reference('<img src=x onerror="run()">')]});
  assert.match(html,/&lt;b&gt;&amp; /);
  assert.match(html,/&lt;img src=x onerror=&quot;run\(\)&quot;&gt;/);
  assert.doesNotMatch(html,/<b>|<img/);
});

test('malformed or excessive annotations fall back to the escaped plain message', () => {
  const invalid=[[],{},[12],[null],[{type:'reference',label:'UART4'}],[reference('')],[reference('x'.repeat(161))],[reference('UART4','driver" onclick="x')],['x'.repeat(4097)],Array(257).fill('x'),Array(5).fill('x'.repeat(4096))];
  for(const messageParts of invalid)assert.equal(renderIssueMessage({message:'<plain> & safe',messageParts}),'&lt;plain&gt; &amp; safe');
  assert.equal(renderIssueMessage(null),'');
});

test('sanitization copies only reference metadata and does not retain mutable input objects', () => {
  const parts=[reference('UART4','peripheral'),' ',{...reference('角度编码器'),html:'<script>bad</script>',nested:{}}];
  const copy=sanitizeIssueMessageParts(parts);
  assert.deepEqual(copy,[reference('UART4','peripheral'),' ',reference('角度编码器')]);
  copy[0].label='changed';
  assert.equal(parts[0].label,'UART4');
});
