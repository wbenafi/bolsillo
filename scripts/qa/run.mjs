import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const relay=spawn(process.execPath,['scripts/qa/clerk-relay.mjs'],{env:{...process.env,QA_RELAY_PORT:'0'},stdio:['ignore','pipe','inherit']});
let runner;
const stop=()=>{runner?.kill('SIGTERM');relay.kill('SIGTERM');};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{
  const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('El relay de QA no inició.')),15000);
    const lines=createInterface({input:relay.stdout});
    lines.on('line',line=>{if(line.startsWith('QA_RELAY_READY ')){clearTimeout(timer);resolve(Number(line.split(' ')[1]));}});
    relay.once('error',error=>{clearTimeout(timer);reject(error);});
    relay.once('exit',code=>{clearTimeout(timer);reject(new Error(`Relay de QA terminó (${code}).`));});
  });
  runner=spawn(process.execPath,['scripts/qa/transaction-files.mjs'],{env:{...process.env,QA_RELAY_URL:`http://127.0.0.1:${port}`},stdio:'inherit'});
  process.exitCode=await new Promise((resolve,reject)=>{runner.once('error',reject);runner.once('exit',code=>resolve(code??1));});
}catch(error){console.error(error.message);process.exitCode=1;}finally{stop();}
