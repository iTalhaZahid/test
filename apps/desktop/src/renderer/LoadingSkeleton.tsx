export function LoadingSkeleton({label='Loading',variant='list',rows=3,className=''}:{
  label?:string;variant?:'text'|'field'|'list'|'cards'|'page';rows?:number;className?:string;
}) {
  const compact=variant==='text'||variant==='field';
  return <span role="status" aria-live="polite" aria-busy="true" className={`loading-skeleton loading-skeleton--${variant} ${className}`}>
    <span className="sr-only">{label}</span>
    {compact?<span aria-hidden="true" className="skeleton-block"/>:Array.from({length:rows},(_,index)=><span key={index} aria-hidden="true" className="skeleton-row">
      <span className="skeleton-block skeleton-thumbnail"/>
      <span className="skeleton-lines"><span className="skeleton-block skeleton-title"/><span className="skeleton-block skeleton-detail"/></span>
    </span>)}
  </span>;
}
