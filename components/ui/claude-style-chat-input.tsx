"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Loader2,
  Plus,
  X,
} from "lucide-react";

/* --- ICONS --- */
export const Icons = {
  Logo: (props: React.SVGProps<SVGSVGElement>) => (
    <svg
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      role="presentation"
      {...props}
    >
      <defs>
        <ellipse id="petal-pair" cx="100" cy="100" rx="90" ry="22" />
      </defs>
      <g fill="currentColor" fillRule="evenodd">
        <use href="#petal-pair" transform="rotate(0 100 100)" />
        <use href="#petal-pair" transform="rotate(45 100 100)" />
        <use href="#petal-pair" transform="rotate(90 100 100)" />
        <use href="#petal-pair" transform="rotate(135 100 100)" />
      </g>
    </svg>
  ),
  // Lucide supplies the control icons so the set stays consistent.
  Plus: Plus,
  Thinking: (props: React.SVGProps<SVGSVGElement>) => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M10.3857 2.50977C14.3486 2.71054 17.5 5.98724 17.5 10C17.5 14.1421 14.1421 17.5 10 17.5C5.85786 17.5 2.5 14.1421 2.5 10C2.5 9.72386 2.72386 9.5 3 9.5C3.27614 9.5 3.5 9.72386 3.5 10C3.5 13.5899 6.41015 16.5 10 16.5C13.5899 16.5 16.5 13.5899 16.5 10C16.5 6.5225 13.7691 3.68312 10.335 3.50879L10 3.5L9.89941 3.49023C9.67145 3.44371 9.5 3.24171 9.5 3C9.5 2.72386 9.72386 2.5 10 2.5L10.3857 2.50977ZM10 5.5C10.2761 5.5 10.5 5.72386 10.5 6V9.69043L13.2236 11.0527C13.4706 11.1762 13.5708 11.4766 13.4473 11.7236C13.3392 11.9397 13.0957 12.0435 12.8711 11.9834L12.7764 11.9473L9.77637 10.4473C9.60698 10.3626 9.5 10.1894 9.5 10V6C9.5 5.72386 9.72386 5.5 10 5.5ZM3.66211 6.94141C4.0273 6.94159 4.32303 7.23735 4.32324 7.60254C4.32324 7.96791 4.02743 8.26446 3.66211 8.26465C3.29663 8.26465 3 7.96802 3 7.60254C3.00021 7.23723 3.29676 6.94141 3.66211 6.94141ZM4.95605 4.29395C5.32146 4.29404 5.61719 4.59063 5.61719 4.95605C5.6171 5.3214 5.3214 5.61709 4.95605 5.61719C4.59063 5.61719 4.29403 5.32146 4.29395 4.95605C4.29395 4.59057 4.59057 4.29395 4.95605 4.29395ZM7.60254 3C7.96802 3 8.26465 3.29663 8.26465 3.66211C8.26446 4.02743 7.96791 4.32324 7.60254 4.32324C7.23736 4.32302 6.94159 4.0273 6.94141 3.66211C6.94141 3.29676 7.23724 3.00022 7.60254 3Z" />
    </svg>
  ),
  SelectArrow: ChevronDown,
  ArrowUp: ArrowUp,
  X: X,
  FileText: FileText,
  Loader2: Loader2,
  Check: Check,
  Archive: Archive,
  Clock: (props: React.SVGProps<SVGSVGElement>) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="currentColor"
      {...props}
    >
      <path d="M10.3857 2.50977C14.3486 2.71054 17.5 5.98724 17.5 10C17.5 14.1421 14.1421 17.5 10 17.5C5.85786 17.5 2.5 14.1421 2.5 10C2.5 9.72386 2.72386 9.5 3 9.5C3.27614 9.5 3.5 9.72386 3.5 10C3.5 13.5899 6.41015 16.5 10 16.5C13.5899 16.5 16.5 13.5899 16.5 10C16.5 6.5225 13.7691 3.68312 10.335 3.50879L10 3.5L9.89941 3.49023C9.67145 3.44371 9.5 3.24171 9.5 3C9.5 2.72386 9.72386 2.5 10 2.5L10.3857 2.50977ZM10 5.5C10.2761 5.5 10.5 5.72386 10.5 6V9.69043L13.2236 11.0527C13.4706 11.1762 13.5708 11.4766 13.4473 11.7236C13.3392 11.9397 13.0957 12.0435 12.8711 11.9834L12.7764 11.9473L9.77637 10.4473C9.60698 10.3626 9.5 10.1894 9.5 10V6C9.5 5.72386 9.72386 5.5 10 5.5ZM3.66211 6.94141C4.0273 6.94159 4.32303 7.23735 4.32324 7.60254C4.32324 7.96791 4.02743 8.26446 3.66211 8.26465C3.29663 8.26465 3 7.96802 3 7.60254C3.00021 7.23723 3.29676 6.94141 3.66211 6.94141ZM4.95605 4.29395C5.32146 4.29404 5.61719 4.59063 5.61719 4.95605C5.6171 5.3214 5.3214 5.61709 4.95605 5.61719C4.59063 5.61719 4.29403 5.32146 4.29395 4.95605C4.29395 4.59057 4.59057 4.29395 4.95605 4.29395ZM7.60254 3C7.96802 3 8.26465 3.29663 8.26465 3.66211C8.26446 4.02743 7.96791 4.32324 7.60254 4.32324C7.23736 4.32302 6.94159 4.0273 6.94141 3.66211C6.94141 3.29676 7.23724 3.00022 7.60254 3Z" />
    </svg>
  ),
};

/* --- UTILS --- */
const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const newId = () => Math.random().toString(36).slice(2, 11);

/* --- TYPES --- */
export type UploadStatus = "pending" | "uploading" | "complete";

export interface AttachedFile {
  id: string;
  file: File;
  type: string;
  preview: string | null;
  uploadStatus: UploadStatus;
  content?: string;
}

export interface PastedContent {
  id: string;
  content: string;
  timestamp: Date;
}

export interface Model {
  id: string;
  name: string;
  description: string;
  badge?: string;
}

export interface ClaudeChatInputPayload {
  message: string;
  files: AttachedFile[];
  pastedContent: PastedContent[];
  model: string;
  isThinkingEnabled: boolean;
}

/* --- COMPONENTS --- */

// 1. File Preview Card
interface FilePreviewCardProps {
  file: AttachedFile;
  onRemove: (id: string) => void;
}

const FilePreviewCard: React.FC<FilePreviewCardProps> = ({ file, onRemove }) => {
  const isImage = file.type.startsWith("image/") && file.preview;

  return (
    <div className="fade-in group relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-line bg-chip transition-colors hover:border-line-strong">
      {isImage ? (
        <div className="relative h-full w-full">
          <img
            src={file.preview!}
            alt={file.file.name}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/0" />
        </div>
      ) : (
        <div className="flex h-full w-full flex-col justify-between p-3">
          <div className="flex items-center gap-2">
            <div className="rounded bg-hover p-1.5">
              <Icons.FileText className="h-4 w-4 text-mid" />
            </div>
            <span className="truncate text-[10px] font-medium uppercase tracking-wider text-low">
              {file.file.name.split(".").pop()}
            </span>
          </div>
          <div className="space-y-0.5">
            <p
              className="truncate text-xs font-medium text-body"
              title={file.file.name}
            >
              {file.file.name}
            </p>
            <p className="text-[10px] text-low">{formatFileSize(file.file.size)}</p>
          </div>
        </div>
      )}

      {/* Remove Button Overlay */}
      <button
        type="button"
        aria-label={`Remove ${file.file.name}`}
        onClick={() => onRemove(file.id)}
        className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Icons.X className="h-3 w-3" />
      </button>

      {/* Upload Status */}
      {file.uploadStatus !== "complete" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <Icons.Loader2 className="h-5 w-5 animate-spin text-white" />
        </div>
      )}
    </div>
  );
};

// 2. Pasted Content Card
interface PastedContentCardProps {
  content: PastedContent;
  onRemove: (id: string) => void;
}

const PastedContentCard: React.FC<PastedContentCardProps> = ({ content, onRemove }) => {
  return (
    <div className="fade-in group relative flex h-28 w-28 flex-shrink-0 flex-col justify-between overflow-hidden rounded-2xl border border-line bg-card p-3 shadow-[var(--card-shadow)]">
      <div className="w-full overflow-hidden">
        <p className="line-clamp-4 select-none whitespace-pre-wrap break-words font-mono text-[10px] leading-[1.4] text-low">
          {content.content}
        </p>
      </div>

      <div className="mt-2 flex w-full items-center justify-between">
        <div className="inline-flex items-center justify-center rounded border border-line bg-chip px-1.5 py-[2px]">
          <span className="font-sans text-[9px] font-bold uppercase tracking-wider text-low">
            PASTED
          </span>
        </div>
      </div>

      <button
        type="button"
        aria-label="Remove pasted text"
        onClick={() => onRemove(content.id)}
        className="absolute right-2 top-2 rounded-full border border-line bg-card p-[3px] text-low opacity-0 shadow-sm transition-colors hover:text-hi group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Icons.X className="h-2 w-2" />
      </button>
    </div>
  );
};

// 3. Model Selector
interface ModelSelectorProps {
  models: Model[];
  selectedModel: string;
  onSelect: (modelId: string) => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  selectedModel,
  onSelect,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentModel = models.find((m) => m.id === selectedModel) || models[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`relative inline-flex h-8 min-w-[4rem] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl pl-2.5 pr-2 text-xs transition-colors duration-200 active:scale-[0.98] ${
          isOpen
            ? "bg-hover text-hi"
            : "text-mid hover:bg-hover hover:text-hi"
        }`}
      >
        <div className="inline-flex h-[14px] items-baseline gap-[3px] font-ui text-[14px] leading-none">
          <div className="flex items-center gap-[4px]">
            <div className="select-none whitespace-nowrap font-medium">
              {currentModel.name}
            </div>
          </div>
        </div>
        <div className="flex h-5 w-5 items-center justify-center opacity-75">
          <Icons.SelectArrow
            className={`shrink-0 opacity-75 transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="fade-in absolute bottom-full right-0 z-50 mb-2 flex w-[260px] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-line bg-raised p-1.5 shadow-2xl"
        >
          {models.map((model) => (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={selectedModel === model.id}
              onClick={() => {
                onSelect(model.id);
                setIsOpen(false);
              }}
              className="group flex w-full items-start justify-between rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-hover"
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-hi">
                    {model.name}
                  </span>
                  {model.badge && (
                    <span
                      className={`rounded-full border px-1.5 py-[1px] text-[10px] font-medium ${
                        model.badge === "Upgrade"
                          ? "border-accent/30 bg-accent-soft text-accent-text"
                          : "border-line text-low"
                      }`}
                    >
                      {model.badge}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-mid">{model.description}</span>
              </div>
              {selectedModel === model.id && (
                <Icons.Check className="mt-1 h-4 w-4 text-accent" />
              )}
            </button>
          ))}

          <div className="mx-2 my-1 h-px bg-line" />

          <button
            type="button"
            className="group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-hi transition-colors hover:bg-hover"
          >
            <span className="text-[13px] font-semibold">More models</span>
            <Icons.SelectArrow className="h-4 w-4 -rotate-90 text-mid" />
          </button>
        </div>
      )}
    </div>
  );
};

// 4. Main Chat Input Component
interface ClaudeChatInputProps {
  onSendMessage: (data: ClaudeChatInputPayload) => void;
}

export const ClaudeChatInput: React.FC<ClaudeChatInputProps> = ({ onSendMessage }) => {
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [pastedContent, setPastedContent] = useState<PastedContent[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedModel, setSelectedModel] = useState("sonnet-4.5");
  const [isThinkingEnabled, setIsThinkingEnabled] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const models: Model[] = [
    { id: "opus-4.5", name: "Opus 4.5", description: "Most capable for complex work" },
    { id: "sonnet-4.5", name: "Sonnet 4.5", description: "Best for everyday tasks" },
    { id: "haiku-4.5", name: "Haiku 4.5", description: "Fastest for quick answers" },
  ];

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 384) + "px"; // 96 * 4 = 384px (max-h-96)
    }
  }, [message]);

  // File Handling
  const handleFiles = useCallback((newFilesList: FileList | File[]) => {
    const newFiles: AttachedFile[] = Array.from(newFilesList).map((file) => {
      const isImage =
        file.type.startsWith("image/") ||
        /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.name);
      return {
        id: newId(),
        file,
        // Force an image type when the extension is what identified it.
        type: isImage ? "image/unknown" : file.type || "application/octet-stream",
        preview: isImage ? URL.createObjectURL(file) : null,
        uploadStatus: "pending",
      };
    });

    setFiles((prev) => [...prev, ...newFiles]);

    // Dynamic Feedback Message
    setMessage((prev) => {
      if (prev) return prev;
      if (newFiles.length === 1) {
        const f = newFiles[0];
        if (f.type.startsWith("image/")) return "Analyzed image...";
        return "Analyzed document...";
      }
      return `Analyzed ${newFiles.length} files...`;
    });

    // Simulate upload completion.
    newFiles.forEach((f) => {
      setTimeout(
        () => {
          setFiles((prev) =>
            prev.map((p) => (p.id === f.id ? { ...p, uploadStatus: "complete" } : p)),
          );
        },
        800 + Math.random() * 1000,
      );
    });
  }, []);

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  const removePastedContent = (id: string) => {
    setPastedContent((prev) => prev.filter((p) => p.id !== id));
  };

  // Drag & Drop
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };

  // Paste Handling
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        const file = items[i].getAsFile();
        if (file) pastedFiles.push(file);
      }
    }

    if (pastedFiles.length > 0) {
      e.preventDefault();
      handleFiles(pastedFiles);
      return;
    }

    // Handle large text paste
    const text = e.clipboardData.getData("text");
    if (text.length > 300) {
      e.preventDefault();
      setPastedContent((prev) => [
        ...prev,
        { id: newId(), content: text, timestamp: new Date() },
      ]);

      if (!message) {
        setMessage("Analyzed pasted text...");
      }
    }
  };

  const handleSend = () => {
    if (!message.trim() && files.length === 0 && pastedContent.length === 0) return;
    onSendMessage({
      message,
      files,
      pastedContent,
      model: selectedModel,
      isThinkingEnabled,
    });
    setMessage("");
    setFiles([]);
    setPastedContent([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasContent = Boolean(message.trim()) || files.length > 0 || pastedContent.length > 0;

  return (
    <div
      className="relative mx-auto w-full max-w-2xl font-sans transition-all duration-300"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Main Container */}
      <div
        className="relative z-10 box-content flex cursor-text flex-col items-stretch rounded-2xl border border-line bg-card font-sans antialiased transition-all duration-200 focus-within:border-line-strong focus-within:shadow-[0_0_25px_rgba(0,0,0,0.15)] hover:shadow-[0_0_20px_rgba(0,0,0,0.12)] dark:border-line dark:focus-within:border-line-strong"
        onClick={() => textareaRef.current?.focus()}
      >
        <div className="flex flex-col px-3 pb-2 pt-3">
          {/* Attachments */}
          {(files.length > 0 || pastedContent.length > 0) && (
            <div className="mb-2.5 flex flex-wrap gap-2">
              {files.map((file) => (
                <FilePreviewCard key={file.id} file={file} onRemove={removeFile} />
              ))}
              {pastedContent.map((content) => (
                <PastedContentCard
                  key={content.id}
                  content={content}
                  onRemove={removePastedContent}
                />
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            placeholder="How can I help you today?"
            className="composer-input max-h-96 min-h-[24px] w-full resize-none bg-transparent py-1 text-[15px] leading-6 text-body outline-none placeholder:text-low"
          />

          {/* Toolbar */}
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                aria-label="Attach files"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-mid transition-colors hover:bg-hover hover:text-hi active:scale-[0.98]"
              >
                <Icons.Plus className="h-[18px] w-[18px]" />
              </button>

              <button
                type="button"
                aria-pressed={isThinkingEnabled}
                onClick={() => setIsThinkingEnabled((prev) => !prev)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs transition-colors active:scale-[0.98] ${
                  isThinkingEnabled
                    ? "bg-accent-soft text-accent-text"
                    : "text-mid hover:bg-hover hover:text-hi"
                }`}
              >
                <Icons.Thinking className="h-4 w-4" />
                <span className="font-medium">Thinking</span>
              </button>
            </div>

            <div className="flex items-center gap-1">
              <ModelSelector
                models={models}
                selectedModel={selectedModel}
                onSelect={setSelectedModel}
              />
              <button
                type="button"
                aria-label="Send message"
                disabled={!hasContent}
                onClick={handleSend}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-xl transition-colors active:scale-[0.98] ${
                  hasContent
                    ? "bg-accent text-on-accent hover:brightness-110"
                    : "send-idle cursor-not-allowed"
                }`}
              >
                <Icons.ArrowUp className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Drop target */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft text-sm font-medium text-accent-text">
          Drop files to attach
        </div>
      )}
    </div>
  );
};

export default ClaudeChatInput;
