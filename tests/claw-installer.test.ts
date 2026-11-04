import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore JavaScript installer exports a pure configuration transform.
import {prepareEnv} from '../scripts/claw-empire.mjs';
test('Claw installer keeps secrets, forces loopback, disables video bootstrap, and is repeatable',()=>{
 const source='HOST=0.0.0.0\nPORT=9999\nOAUTH_ENCRYPTION_SECRET="existing-secret"\nINBOX_WEBHOOK_SECRET=__CHANGE_ME__\nCUSTOM=value\n';
 const configured=prepareEnv(source);
 assert.match(configured,/^HOST=127\.0\.0\.1$/m);assert.match(configured,/^PORT=8790$/m);
 assert.match(configured,/^REMOTION_RUNTIME_BOOTSTRAP=0$/m);assert.match(configured,/^OAUTH_ENCRYPTION_SECRET="existing-secret"$/m);
 assert.match(configured,/^INBOX_WEBHOOK_SECRET=[a-f0-9]{64}$/m);assert.match(configured,/^CUSTOM=value$/m);
 assert.equal(prepareEnv(configured),configured);
});
