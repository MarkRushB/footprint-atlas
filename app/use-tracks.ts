'use client';
import { useEffect, useRef, useState } from 'react';
import type { Filters, Selection, TrackMeta } from './track-types';

export function useTracks(filters: Filters) {
  const worker = useRef<Worker | null>(null), revision = useRef(0);
  const [meta, setMeta] = useState<TrackMeta | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    // document.baseURI keeps assets working both at / locally and under a
    // GitHub Pages project path such as /footprint-atlas/.
    const instance = new Worker(new URL('tracks-worker.js', document.baseURI), { type: 'module' });
    worker.current = instance;
    instance.onmessage = ({ data }) => {
      if (data.type === 'ready') setMeta(data.meta);
      if (data.revision !== undefined && data.revision !== revision.current) return;
      if (data.type === 'selection') { setSelection(data); setPending(false); setError(''); }
      if (data.type === 'error') { setError(data.message); setPending(false); }
    };
    instance.onerror = () => { setError('后台数据加载失败，请重新加载页面。'); setPending(false); };
    return () => { instance.terminate(); worker.current = null; };
  }, []);
  useEffect(() => {
    if (!meta || !worker.current) return;
    const id = ++revision.current;
    if (filters.start && filters.end && filters.start > filters.end) { setError('开始日期不能晚于结束日期，地图保留上一次结果。'); setPending(false); return; }
    setPending(true); setError('');
    const timer = setTimeout(() => worker.current?.postMessage({ type: 'select', revision: id, options: filters }), 180);
    return () => clearTimeout(timer);
  }, [meta, filters]);
  return { meta, selection, pending, error };
}
