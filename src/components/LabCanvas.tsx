import { useMemo, type CSSProperties } from 'react';
import { Background, Controls, Handle, MarkerType, Panel as FlowPanel, Position, ReactFlow, type Edge, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Activity, Archive, Database, Filter, HardDrive, Layers, Radio, Send, Server, Users, type LucideIcon } from 'lucide-react';
import type { NodeId, NodeStat } from '../engine/metrics';

type NData = { title: string; desc: string; Icon: LucideIcon; stat: NodeStat; selected: boolean };

export const NODE_DEFS: { id: NodeId; title: string; desc: string; Icon: LucideIcon; x: number; y: number }[] = [
  { id: 'traffic', title: 'Traffic Generator', desc: 'Creates user requests at the configured rate.', Icon: Users, x: 0, y: 40 },
  { id: 'A', title: 'Service A', desc: 'Front service; calls Service B.', Icon: Server, x: 250, y: 40 },
  { id: 'B', title: 'Service B', desc: 'Middle service; calls Service C.', Icon: Server, x: 500, y: 40 },
  { id: 'C', title: 'Service C', desc: 'Backend service (last hop).', Icon: Server, x: 750, y: 40 },
  { id: 'collector', title: 'OpenTelemetry Collector', desc: 'Receives spans from the services.', Icon: Radio, x: 0, y: 290 },
  { id: 'tail', title: 'Tail Sampling Processor', desc: 'Keeps important traces, drops the rest.', Icon: Filter, x: 250, y: 290 },
  { id: 'batch', title: 'Batch Processor', desc: 'Groups traces into batches.', Icon: Layers, x: 500, y: 290 },
  { id: 'exporter', title: 'Trace Exporter / Indexer', desc: 'Sends batches onward (with retries).', Icon: Send, x: 750, y: 290 },
  { id: 'cold', title: 'Cold Object Storage', desc: 'Cheap long-term archive objects.', Icon: HardDrive, x: 250, y: 540 },
  { id: 'archival', title: 'Archival Worker', desc: 'Moves eligible traces to cold storage.', Icon: Archive, x: 500, y: 540 },
  { id: 'opensearch', title: 'OpenSearch - Searchable Storage', desc: 'Indexes traces so they can be searched.', Icon: Database, x: 750, y: 540 },
];
const BORDER: Record<string, string> = { ok: 'border-indigo-400', idle: 'border-slate-300', warn: 'border-amber-400', down: 'border-red-500' };
const CHIP: Record<string, string> = { ok: 'bg-emerald-100 text-emerald-800', idle: 'bg-slate-100 text-slate-600', warn: 'bg-amber-100 text-amber-800', down: 'bg-red-100 text-red-800' };
const STATUS_TXT: Record<string, string> = { ok: 'Healthy', idle: 'Idle', warn: 'Busy / backlog', down: 'FAULT' };

function LabNode({ data }: NodeProps<Node<NData, 'lab'>>) {
  const { title, desc, Icon, stat, selected } = data;
  return (
    <div className={`w-[200px] rounded-lg border-2 bg-white p-2 text-left shadow-sm ${BORDER[stat.status]} ${selected ? 'ring-2 ring-violet-500' : ''} ${stat.status === 'down' ? 'bg-red-50' : ''}`}>
      <Handle type="target" position={Position.Left} id="tl" className="!h-2 !w-2 !bg-indigo-400" />
      <Handle type="target" position={Position.Top} id="tt" className="!h-2 !w-2 !bg-indigo-400" />
      <Handle type="target" position={Position.Right} id="tr" className="!h-2 !w-2 !bg-indigo-400" />
      <Handle type="source" position={Position.Right} id="sr" className="!h-2 !w-2 !bg-violet-500" />
      <Handle type="source" position={Position.Bottom} id="sb" className="!h-2 !w-2 !bg-violet-500" />
      <Handle type="source" position={Position.Left} id="sl" className="!h-2 !w-2 !bg-violet-500" />
      <div className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight text-indigo-950"><Icon size={16} className="shrink-0 text-indigo-600" />{title}</div>
      <div className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{desc}</div>
      <div className="mt-1 flex items-center justify-between text-[10.5px]">
        <span className={`rounded px-1.5 py-0.5 font-semibold ${CHIP[stat.status]}`}>{stat.status === 'down' ? '⚠ ' : ''}{STATUS_TXT[stat.status]}</span>
        <span className="text-slate-600">in {stat.inCount} → out {stat.outCount}</span>
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-500"><span>{stat.note}</span><span className="font-medium text-violet-700">⚙ Configure</span></div>
    </div>
  );
}
function LaneNode({ data }: NodeProps<Node<{ text: string }, 'lane'>>) {
  return <div className="w-[600px] text-[11px] font-bold tracking-wide text-violet-700">{data.text}</div>;
}
const nodeTypes: NodeTypes = { lab: LabNode as never, lane: LaneNode as never };

const REQ = { stroke: '#4f46e5', strokeWidth: 2.5 };
const TEL = { stroke: '#7c3aed', strokeWidth: 1.8, strokeDasharray: '7 4' };
const ARC = { stroke: '#2563eb', strokeWidth: 1.8, strokeDasharray: '2 4' };

export function LabCanvas({ stats, selected, onSelect, running }: { stats: Record<NodeId, NodeStat>; selected: NodeId | null; onSelect: (id: NodeId) => void; running: boolean }) {
  const nodes = useMemo<Node[]>(() => [
    ...NODE_DEFS.map((d) => ({ id: d.id, type: 'lab', position: { x: d.x, y: d.y }, draggable: false, data: { title: d.title, desc: d.desc, Icon: d.Icon, stat: stats[d.id], selected: selected === d.id } as Record<string, unknown> })),
    { id: 'l1', type: 'lane', position: { x: 0, y: 8 }, draggable: false, selectable: false, data: { text: 'APPLICATION REQUEST PATH  (user request travels through the services)' } },
    { id: 'l2', type: 'lane', position: { x: 0, y: 258 }, draggable: false, selectable: false, data: { text: 'TELEMETRY PIPELINE  (trace data produced by the services)' } },
    { id: 'l3', type: 'lane', position: { x: 250, y: 508 }, draggable: false, selectable: false, data: { text: 'ARCHIVAL & SEARCH  (long-term storage and indexing)' } },
  ], [stats, selected]);
  const edges = useMemo<Edge[]>(() => {
    const e = (id: string, source: string, target: string, sh: string, th: string, style: CSSProperties, label?: string, anim = false): Edge =>
      ({ id, source, target, sourceHandle: sh, targetHandle: th, type: 'smoothstep', style, label, animated: anim && running, markerEnd: { type: MarkerType.ArrowClosed, color: String(style.stroke) }, labelStyle: { fontSize: 10 } });
    return [
      e('r1', 'traffic', 'A', 'sr', 'tl', REQ, 'request', true), e('r2', 'A', 'B', 'sr', 'tl', REQ, 'call + trace context', true), e('r3', 'B', 'C', 'sr', 'tl', REQ, undefined, true),
      e('t1', 'A', 'collector', 'sb', 'tt', TEL, 'spans', true), e('t2', 'B', 'collector', 'sb', 'tt', TEL), e('t3', 'C', 'collector', 'sb', 'tt', TEL),
      e('t4', 'collector', 'tail', 'sr', 'tl', TEL, undefined, true), e('t5', 'tail', 'batch', 'sr', 'tl', TEL, 'retained', true), e('t6', 'batch', 'exporter', 'sr', 'tl', TEL, 'batches', true),
      e('t7', 'exporter', 'opensearch', 'sb', 'tt', TEL, 'index', true), e('a1', 'exporter', 'archival', 'sb', 'tt', ARC, 'eligible', true), e('a2', 'archival', 'cold', 'sl', 'tr', ARC, 'objects', true),
    ];
  }, [running]);
  return (
    <div className="h-[470px] overflow-hidden rounded-lg border border-slate-200 bg-white">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.04 }} minZoom={0.3} nodesDraggable={false} nodesConnectable={false}
        onNodeClick={(_, n) => n.type === 'lab' && onSelect(n.id as NodeId)}>
        <Background color="#e0e7ff" gap={20} />
        <Controls showInteractive={false} />
        <FlowPanel position="top-right">
          <div className="rounded bg-white/90 p-2 text-[10.5px] shadow">
            <div className="mb-1 flex items-center gap-1 font-semibold text-indigo-950"><Activity size={12} /> Simulated - click any box to configure</div>
            <div className="flex items-center gap-1"><span className="inline-block h-0 w-6 border-t-2 border-indigo-600" /> application request</div>
            <div className="flex items-center gap-1"><span className="inline-block h-0 w-6 border-t-2 border-dashed border-violet-600" /> telemetry (trace data)</div>
            <div className="flex items-center gap-1"><span className="inline-block h-0 w-6 border-t-2 border-dotted border-blue-600" /> archival</div>
          </div>
        </FlowPanel>
      </ReactFlow>
    </div>
  );
}
