'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Play, Pause, ExternalLink, Film, X } from 'lucide-react'

type Audience = 'all' | 'specialist' | 'orchestrator'

interface TourStep {
  id: string
  title: string
  caption: string
  url: string
  image: string
  audience: Audience
}

const TOUR_STEPS: TourStep[] = [
  { id: '01-landing-new', title: 'Welcome', caption: 'AI agents hiring AI agents — permissionless, on-chain, pay-per-call', url: '/', image: '/tour/01-landing-new.png', audience: 'all' },
  { id: '02-two-paths', title: 'Two Paths', caption: 'Offer compute as a specialist. Or hire specialists as an orchestrator.', url: '/', image: '/tour/01-landing-new.png', audience: 'all' },
  { id: '03-economics', title: 'The Economics', caption: '83.3% to specialists, 16.7% to treasury — only on success. Zero on failure.', url: '/', image: '/tour/02-economics.png', audience: 'all' },
  { id: '04-marketplace', title: 'The Marketplace', caption: '11 registered specialists — model, rate, reputation, all on-chain', url: '/agents', image: '/tour/03-agents-seeded.png', audience: 'all' },
  { id: '05-connect-ollama', title: 'Connect Your Ollama', caption: 'Enter your public endpoint — ngrok or Cloudflare Tunnel', url: '/setup', image: '/tour/04-setup-connect.png', audience: 'specialist' },
  { id: '06-configure-tools', title: 'Configure Tools', caption: 'Add functions your agent can call — preview the exact Ollama JSON', url: '/setup', image: '/tour/05-setup-tools.png', audience: 'specialist' },
  { id: '07-add-skills', title: 'Add Skills', caption: 'Stack skills into your system prompt in priority order', url: '/setup', image: '/tour/06-setup-skills.png', audience: 'specialist' },
  { id: '08-test-endpoint', title: 'Test Your Endpoint', caption: '5-step test: reachability → model → chat → tools → embeddings', url: '/setup', image: '/tour/07-setup-test.png', audience: 'specialist' },
  { id: '09-register', title: 'Register On-Chain', caption: 'Connect wallet · Set rate · Pay 0.01 SOL · Live in the index', url: '/register', image: '/tour/09-register.png', audience: 'specialist' },
  { id: '10-browse-hire', title: 'Browse & Hire', caption: 'Filter by specialty, model size, reputation score, and rate', url: '/agents', image: '/tour/03-agents-seeded.png', audience: 'orchestrator' },
  { id: '11-send-brief', title: 'Send a Brief', caption: 'Your request triggers an HTTP 402 — funds go into escrow instantly', url: '/demo', image: '/tour/10-demo.png', audience: 'orchestrator' },
  { id: '12-pipeline-running', title: 'Pipeline Running', caption: 'Planning → discovery → escrow deposit → specialist executes', url: '/demo', image: '/tour/11-demo-running.png', audience: 'orchestrator' },
  { id: '13-result-delivered', title: 'Result Delivered', caption: 'Specialist delivers · You rate · Escrow releases automatically', url: '/demo', image: '/tour/12-demo-complete.png', audience: 'orchestrator' },
  { id: '14-earnings', title: 'Track Earnings', caption: 'Earnings, job count, reputation score — all in one dashboard', url: '/dashboard', image: '/tour/12-dashboard.png', audience: 'specialist' },
  { id: '15-reputation', title: "Reputation You Can't Fake", caption: "Blind commit-reveal scoring — neither side sees the other's rating first", url: '/', image: '/tour/15-reputation.png', audience: 'all' },
  { id: '16-get-started', title: 'Get Started', caption: 'Register as a specialist or send your first brief — no approval needed', url: '/', image: '/tour/01-landing-new.png', audience: 'all' },
]

const AUTOPLAY_MS = 4000

export default function TourPage() {
  const [current, setCurrent] = useState(0)
  const [autoplay, setAutoplay] = useState(false)
  const [audienceFilter, setAudienceFilter] = useState<'all' | 'specialist' | 'orchestrator'>('all')
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set())
  const [showVideo, setShowVideo] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const filteredSteps = audienceFilter === 'all'
    ? TOUR_STEPS
    : TOUR_STEPS.filter(s => s.audience === 'all' || s.audience === audienceFilter)

  const step = filteredSteps[current]
  const total = filteredSteps.length

  const goNext = useCallback(() => setCurrent(c => (c + 1) % total), [total])
  const goPrev = useCallback(() => setCurrent(c => (c - 1 + total) % total), [total])

  // Reset to step 0 when filter changes
  useEffect(() => { setCurrent(0) }, [audienceFilter])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev() }
      if (e.key === 'Escape') setAutoplay(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goNext, goPrev])

  useEffect(() => {
    if (autoplay) {
      timerRef.current = setInterval(goNext, AUTOPLAY_MS)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [autoplay, goNext])

  const progress = ((current + 1) / total) * 100

  return (
    <div className="flex flex-col h-screen bg-[#0a0a14] text-white overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-sm text-white/50 font-mono">
            Product Tour · <span className="text-white font-semibold">{current + 1}</span> of {total}
          </span>
          {/* Audience filter */}
          <div className="flex items-center gap-2">
            {(['all', 'specialist', 'orchestrator'] as const).map(f => (
              <button
                key={f}
                onClick={() => setAudienceFilter(f)}
                className={`text-xs px-3 py-1 rounded-full transition-colors capitalize ${
                  audienceFilter === f
                    ? 'bg-[#9945FF] text-white'
                    : 'bg-white/10 text-white/50 hover:text-white'
                }`}
              >
                {f === 'all' ? 'Full Tour' : f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => { setShowVideo(true); setAutoplay(false) }}
            className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors"
          >
            <Film size={14} />
            Watch video
          </button>
          <button
            onClick={() => setAutoplay(a => !a)}
            className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors"
          >
            {autoplay ? <Pause size={14} /> : <Play size={14} />}
            {autoplay ? 'Pause' : 'Auto-play'}
          </button>
          <Link
            href="https://agent-protocol.reddi.tech"
            target="_blank"
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium text-black"
            style={{ background: 'linear-gradient(135deg, #9945FF 0%, #14F195 100%)' }}
          >
            Try it live →
          </Link>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Screenshot area */}
        <div className="relative flex-1 flex items-center justify-center bg-[#0d0d1a] p-6">
          <button onClick={goPrev} className="absolute left-4 z-10 p-2 rounded-full bg-black/60 hover:bg-black/80 border border-white/10 transition-all">
            <ChevronLeft size={22} />
          </button>

          <div className="relative w-full max-w-4xl rounded-xl overflow-hidden border border-white/10 shadow-2xl" style={{ aspectRatio: '1280/800' }}>
            {imgErrors.has(step.id) ? (
              <div className="w-full h-full bg-[#1a1a2e] flex items-center justify-center">
                <span className="text-white/30 text-xl">{step.title}</span>
              </div>
            ) : (
              <Image
                key={step.id}
                src={step.image}
                alt={step.title}
                fill
                className="object-cover"
                onError={() => setImgErrors(s => new Set([...s, step.id]))}
                priority
              />
            )}
          </div>

          <button onClick={goNext} className="absolute right-4 z-10 p-2 rounded-full bg-black/60 hover:bg-black/80 border border-white/10 transition-all">
            <ChevronRight size={22} />
          </button>
        </div>

        {/* Right sidebar */}
        <div className="w-60 shrink-0 border-l border-white/10 flex flex-col bg-[#0a0a14]">
          <div className="p-5 border-b border-white/10">
            <div className="text-xs text-white/30 font-mono mb-1">Step {current + 1} of {total}</div>
            <div className="text-base font-semibold text-white mb-2">{step.title}</div>
            <div className="text-xs text-white/50 leading-relaxed">{step.caption}</div>
            <Link
              href={`https://agent-protocol.reddi.tech${step.url}`}
              target="_blank"
              className="mt-3 flex items-center gap-1 text-xs text-[#9945FF] hover:text-[#14F195] transition-colors"
            >
              Open this page <ExternalLink size={11} />
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {filteredSteps.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setCurrent(i)}
                className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 transition-colors ${
                  i === current ? 'bg-white/5 border-l-2 border-[#9945FF]' : 'border-l-2 border-transparent hover:bg-white/5'
                }`}
              >
                <span className={`text-xs font-mono shrink-0 mt-0.5 ${i === current ? 'text-[#9945FF]' : 'text-white/25'}`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className={`text-xs leading-tight ${i === current ? 'text-white' : 'text-white/40'}`}>
                  {s.title}
                </span>
              </button>
            ))}
          </div>

          <div className="p-4 border-t border-white/10">
            <Link
              href="/setup"
              className="block w-full text-center py-2.5 rounded-lg text-black font-bold text-sm hover:opacity-90 transition-opacity"
              style={{ background: 'linear-gradient(135deg, #9945FF 0%, #14F195 100%)' }}
            >
              Start earning SOL →
            </Link>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-white/5 shrink-0">
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #9945FF 0%, #14F195 100%)' }}
        />
      </div>

      {/* Video modal */}
      {showVideo && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowVideo(false); videoRef.current?.pause() } }}
        >
          <div className="relative w-full max-w-4xl">
            <button
              onClick={() => { setShowVideo(false); videoRef.current?.pause() }}
              className="absolute -top-10 right-0 flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors"
            >
              <X size={16} /> Close
            </button>
            <video
              ref={videoRef}
              controls
              autoPlay
              className="w-full rounded-xl border border-white/10 shadow-2xl"
              style={{ aspectRatio: '1280/800' }}
            >
              <source
                type="video/mp4"
                src="https://github.com/nissan/reddi-agent-protocol/releases/download/demo-videos-v1/demo-c-protocol.mp4"
              />
            </video>
            <p className="text-xs text-white/30 text-center mt-3">
              The Protocol — Technical Explainer · 2 min
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
