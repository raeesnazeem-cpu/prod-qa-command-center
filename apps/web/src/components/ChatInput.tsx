import React, { useState, useRef, useEffect } from "react"
import { Send, Mic, MicOff, Settings, Loader2 } from "lucide-react"
import { useAuth } from "@clerk/react"

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSendMessage: (message: string) => void
  disabled?: boolean
}

export const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSendMessage,
  disabled,
}) => {
  const { getToken } = useAuth()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isListening, setIsListening] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const MAX_CHARS = 500

  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string>("")
  const [volume, setVolume] = useState(0)
  const [showSettings, setShowSettings] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Hardware Detection
  useEffect(() => {
    const getMics = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioMics = devices.filter((d) => d.kind === "audioinput")
        setMics(audioMics)
        if (audioMics.length > 0 && !selectedMicId) {
          const defaultMic =
            audioMics.find((m) => m.deviceId === "default") || audioMics[0]
          setSelectedMicId(defaultMic.deviceId)
        }
      } catch (err) {
        console.error("Error listing mics:", err)
      }
    }
    getMics()
    navigator.mediaDevices.ondevicechange = getMics
  }, [selectedMicId])

  // Volume Meter Logic
  const startMonitoring = async (stream: MediaStream) => {
    try {
      const audioContext = new (
        window.AudioContext || (window as any).webkitAudioContext
      )()
      const analyser = audioContext.createAnalyser()
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)
      analyser.fftSize = 256
      analyserRef.current = analyser
      audioContextRef.current = audioContext

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const updateVolume = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(dataArray)
        const sum = dataArray.reduce((a, b) => a + b, 0)
        const avg = sum / dataArray.length
        setVolume(avg)
        if (stream.active) requestAnimationFrame(updateVolume)
      }
      updateVolume()
    } catch (err) {
      console.error("Volume monitoring error:", err)
    }
  }

  const stopListening = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop()
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    audioContextRef.current?.close()
    setIsListening(false)
    setVolume(0)
  }

  const startListening = async () => {
    try {
      chunksRef.current = []
      const constraints = {
        audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" })
        await handleTranscription(audioBlob)
      }

      mediaRecorder.start()
      setIsListening(true)
      startMonitoring(stream)
    } catch (err) {
      console.error("Failed to start recording:", err)
      setIsListening(false)
    }
  }

  const handleTranscription = async (blob: Blob) => {
    setIsTranscribing(true)
    try {
      const token = await getToken()
      const reader = new FileReader()
      reader.readAsDataURL(blob)
      reader.onloadend = async () => {
        try {
          const base64Audio = reader.result as string

          const response = await fetch(
            `${import.meta.env.VITE_API_URL}/api/chat/transcribe`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ audio: base64Audio }),
            },
          )

          if (!response.ok) throw new Error("Transcription failed")
          const data = await response.json()

          if (data.text) {
            onChange(value + (value ? " " : "") + data.text.trim())
          }
        } catch (err) {
          console.error("Transcription error:", err)
        } finally {
          setIsTranscribing(false)
        }
      }
    } catch (err) {
      console.error("Auth/Read error:", err)
      setIsTranscribing(false)
    }
  }

  const toggleListening = () => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }

  const handleSendMessage = () => {
    if (value.trim() && !disabled && value.length <= MAX_CHARS) {
      onSendMessage(value.trim())
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      const newHeight = Math.min(textareaRef.current.scrollHeight, 120) // roughly 4-5 lines
      textareaRef.current.style.height = `${newHeight}px`
    }
  }, [value])

  return (
    <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-[#131d22]">
      <div className="relative">
        {showSettings && (
          <div className="absolute bottom-full mb-2 right-0 w-64 bg-slate-50 dark:bg-[#1d2a31] border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-3 z-50 animate-in fade-in slide-in-from-bottom-2">
            <h4 className="text-[10px] font-bold text-slate-900 dark:text-slate-200 uppercase tracking-widest mb-2">
              Microphone Settings
            </h4>

            <div className="space-y-3">
              <div>
                <p className="text-[9px] text-slate-500 mb-1">
                  Select Input Source:
                </p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {mics.length > 0 ? (
                    mics.map((mic, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedMicId(mic.deviceId)}
                        className={`w-full text-left text-[10px] truncate p-1.5 rounded border transition-all ${
                          selectedMicId === mic.deviceId
                            ? "bg-accent/10 border-accent text-accent font-medium"
                            : "bg-slate-50 dark:bg-[#131d22] border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1d2a31]"
                        }`}
                      >
                        {mic.label || `Microphone ${idx + 1}`}
                      </button>
                    ))
                  ) : (
                    <p className="text-[10px] text-red-400 italic">
                      No mics found
                    </p>
                  )}
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <p className="text-[9px] text-slate-500">Live Input Level:</p>
                  <span className="text-[9px] font-mono text-slate-400">
                    {Math.round(volume)}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-75"
                    style={{ width: `${Math.min(volume * 2, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isTranscribing
              ? "Transcribing audio..."
              : "Ask a question about this project..."
          }
          disabled={disabled || isTranscribing}
          maxLength={MAX_CHARS}
          className="w-full bg-slate-50 dark:bg-[#131d22] border border-slate-200 dark:border-slate-700 dark:text-slate-200 rounded-xl py-3 pl-4 pr-24 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all resize-none min-h-[44px] max-h-[120px] disabled:opacity-50 disabled:cursor-not-allowed"
          rows={1}
        />

        <div className="absolute right-2 bottom-2 flex items-center space-x-1.5">
          {isTranscribing && (
            <Loader2 className="w-3 h-3 text-accent animate-spin mr-1" />
          )}
          <span
            className={`text-[10px] font-medium mr-1 ${value.length >= MAX_CHARS ? "text-red-400" : "text-slate-400"}`}
          >
            {value.length}/{MAX_CHARS}
          </span>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded-lg transition-all ${showSettings ? "bg-slate-200 dark:bg-[#1d2a31] text-slate-700 dark:text-slate-200" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1d2a31]"}`}
            title="Microphone Settings"
            type="button"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={toggleListening}
            disabled={isTranscribing || disabled}
            className={`p-1.5 rounded-lg transition-all shadow-sm ${
              isListening
                ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
                : "bg-slate-100 dark:bg-[#131d22] text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-[#1d2a31]"
            } disabled:opacity-50`}
            title="Voice input"
            type="button"
          >
            {isListening ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={handleSendMessage}
            disabled={
              !value.trim() ||
              disabled ||
              value.length > MAX_CHARS ||
              isTranscribing
            }
            className="p-1.5 rounded-lg bg-accent text-white hover:bg-accent/80 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 transition-all shadow-sm"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
