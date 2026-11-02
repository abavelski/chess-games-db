import { useEffect, useState } from 'react';
import './personal-studies-types';

export default function PersonalStudiesWorkspace({ active }: {active: boolean}) {
 const [path,setPath]=useState(''),[error,setError]=useState('');
 useEffect(()=>{window.personalStudies.status().then(s=>setPath(s.path)).catch(e=>setError(String(e)));},[]);
 return <main className="personal-studies-workspace" aria-label="My Studies" data-active={active}>
  <h1>My Studies</h1>
  {error&&<p role="alert">{error}</p>}
  <p>Private local studies. One study contains one game and its variations.</p>
  <p>Storage: {path||'Opening storage…'}</p>
 </main>;
}
