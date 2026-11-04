#!/usr/bin/env node
import { patchPet } from './patch-pet.js';
const directory = process.argv[2];
if (!directory) {
  console.log('用法：dsh-pet-memory-patch /绝对路径/node_modules/dsh-pet [--restore]');
  process.exitCode = 1;
} else {
  try { console.log(await patchPet(directory, process.argv.includes('--restore'))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
