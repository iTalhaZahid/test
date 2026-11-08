import { Router } from 'express';
import { posController } from '../controllers/pos-controller.js';
import type { PosModel } from '../models/pos-model.js';
import { ApiError } from '../models/validation.js';

export function posRoutes(model: PosModel) {
  const router=Router(), controller=posController(model);
  const attempts=new Map<string,{count:number;until:number}>();
  router.use(['/auth/login','/auth/password'],(request,_response,next)=>{
    const now=Date.now(),key=request.ip||'unknown';
    for(const [key,value] of attempts)if(value.until<now)attempts.delete(key);
    const current=attempts.get(key)??{count:0,until:now+60000};
    if(++current.count>20||attempts.size>10000)throw new ApiError(429,'Too many login attempts. Try again in a minute.');
    attempts.set(key,current);next();
  });
  router.post('/auth/login',controller.login);
  router.post('/auth/password',controller.password);
  router.post('/users',controller.createUser);
  router.post('/sync/push',controller.push);
  router.get('/sync/pull',controller.pull);
  router.get('/reports/events',controller.events);
  return router;
}
