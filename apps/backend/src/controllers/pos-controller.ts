import type { Request, Response } from 'express';
import type { PosModel } from '../models/pos-model.js';
import { ApiError, integer } from '../models/validation.js';

const bearer = (request: Request) => {
  const header=request.headers.authorization;
  if(!header?.startsWith('Bearer '))throw new ApiError(401,'Authentication required.');
  return header.slice(7);
};
export function posController(model: PosModel) {
  return {
    login: async (request: Request, response: Response) => { response.json(await model.login(request.body)); },
    createUser: async (request: Request, response: Response) => {
      const actor=model.session(bearer(request));
      if(actor.role==='cashier')throw new ApiError(403,'Administrator access required.');
      response.status(201).json({user:await model.createUser(request.body,actor.role==='superuser')});
    },
    password: async (request: Request, response: Response) => {
      await model.password(model.session(bearer(request)),request.body); response.json({ok:true});
    },
    push: (request: Request, response: Response) => { response.json(model.push(model.device(bearer(request)),request.body?.changes)); },
    pull: (request: Request, response: Response) => {
      model.device(bearer(request));
      const cursor=Number(request.query.after??0);
      response.json(model.pull(integer(cursor)));
    },
    events: (request: Request, response: Response) => {
      const actor=model.session(bearer(request));
      if(actor.role==='cashier')throw new ApiError(403,'Administrator access required.');
      const after=integer(Number(request.query.after??0));
      const rows=model.db.prepare('SELECT rowid,device_id,entity,payload FROM events WHERE rowid>? ORDER BY rowid LIMIT 100').all(after);
      response.json({events:rows.map(row=>({cursor:row.rowid,deviceId:row.device_id,entity:row.entity,payload:JSON.parse(String(row.payload))}))});
    },
  };
}
