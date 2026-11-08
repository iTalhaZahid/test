import type { ReactNode } from 'react';
import { LoadingSkeleton } from './LoadingSkeleton';

export function LoadingCard({loading,label,children,className='',skeleton}:{loading:boolean;label:string;children:ReactNode;className?:string;skeleton?:ReactNode}) {
  return <div className={`loading-card ${className}`} aria-busy={loading}>
    <div className={loading?'loading-card-content':undefined} aria-hidden={loading||undefined} inert={loading||undefined}>{children}</div>
    {loading&&<div className="loading-card-placeholder">{skeleton||<LoadingSkeleton label={label} variant="page"/>}</div>}
  </div>;
}
