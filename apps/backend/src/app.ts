import express from 'express';
import { posRoutes } from './routes/pos-routes.js';
import type { PosModel } from './models/pos-model.js';
import { ApiError } from './models/validation.js';
import { webRoutes } from './routes/web-routes.js';

export function createApp(model?: PosModel) {
  const app=express();
  app.disable('x-powered-by');
  app.use((_request,response,next)=>{response.set('Cache-Control','no-store');next();});
  app.get('/health', (_request,response)=>{response.json({status:'ok'});});
  app.use('/api/pos', webRoutes());
  app.use(express.json({limit:'16mb'}));
  if(model)app.use('/api/v1',posRoutes(model));
  app.use((_request,response)=>{response.status(404).json({error:'Not found.'});});
  app.use((error: unknown,_request: express.Request,response: express.Response,next: express.NextFunction)=>{
    if(response.headersSent){next(error);return;}
    const status=error instanceof ApiError?error.status:error instanceof SyntaxError?400:typeof error==='object'&&error&&'status' in error&&error.status===413?413:500;
    response.status(status).json({error:error instanceof ApiError?error.message:status===500?'Unable to complete this request.':'Invalid request body.'});
  });
  return app;
}
export const app=createApp();
