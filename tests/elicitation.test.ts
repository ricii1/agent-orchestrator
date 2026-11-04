import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isEmptyFormRequest} from '../src/elicitation.ts';
test('only unconstrained fieldless object forms qualify as empty confirmations',()=>{
  assert.equal(isEmptyFormRequest({mode:'form',requestedSchema:{type:'object',properties:{}}}),true);
  assert.equal(isEmptyFormRequest({mode:'openai/form',requestedSchema:{type:'object',properties:{},required:[],additionalProperties:false}}),true);
  for(const requestedSchema of [{type:'object',minProperties:1},{type:'object',properties:{name:{type:'string'}}},{type:'object',required:['name']},{type:'string'},{type:'object',properties:[]}])assert.equal(isEmptyFormRequest({mode:'form',requestedSchema}),false);
  assert.equal(isEmptyFormRequest({mode:'url',requestedSchema:{type:'object',properties:{}}}),false);
});
