// kilocode_change - new file
/**
 * GitWatcher - Monitors git repository state and emits events
 *
 * This module provides a lightweight git watcher that:
 * - Emits events for scan lifecycle (start/end)
 * - Emits events for file changes (added/modified) with git hashes
 * - Emits events for file deletions
 * - Monitors git state changes (commits, branch switches)
 * - Supports delta-based scanning on feature branches
 * - Implements vscode.Disposable for proper cleanup
 */

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { EventEmitter } from "events"
import { execGetLines } from "./utils/exec"
import {
	getCurrentBranch,
	getCurrentCommitSha,
	getGitHeadPath,
	isDetachedHead,
	getBaseBranch,
	getGitDiff,
} from "../services/code-index/managed/git-utils"

/**
 * Configuration for GitWatcher
 */
export interface GitWatcherConfig {
	/**
	 * Working directory (git repository root)
	 */
	cwd: string

	/**
	 * Optional override for the default branch name
	 * If not provided, will be determined automatically
	 */
	defaultBranchOverride?: string
}

/**
 * Base event data shared by all GitWatcher events
 */
interface GitWatcherBaseEvent {
	/**
	 * Current branch name
	 */
	branch: string

	/**
	 * Whether or not the event is coming from the base branch
	 */
	isBaseBranch: boolean

	/**
	 * Current instance which emitted the event
	 */
	watcher: GitWatcher
}

/**
 * Event emitted when a scan starts
 */
export interface GitWatcherScanStartEvent extends GitWatcherBaseEvent {
	type: "scan-start"
}

/**
 * Event emitted when a scan completes
 */
export interface GitWatcherScanEndEvent extends GitWatcherBaseEvent {
	type: "scan-end"
}

/**
 * Event emitted for a file change (added or modified)
 */
export interface GitWatcherFileChangedEvent extends GitWatcherBaseEvent {
	type: "file-changed"
	/**
	 * Relative path to the file from repository root
	 */
	filePath: string

	/**
	 * Git hash of the file (from git ls-files -s)
	 */
	fileHash: string
}

/**
 * Event emitted for a file deletion
 */
export interface GitWatcherFileDeletedEvent extends GitWatcherBaseEvent {
	type: "file-deleted"
	/**
	 * Relative path to the deleted file from repository root
	 */
	filePath: string
}

/**
 * Event emitted when the branch changes
 */
export interface GitWatcherBranchChangedEvent extends GitWatcherBaseEvent {
	type: "branch-changed"
	/**
	 * The previous branch name
	 */
	previousBranch: string
	/**
	 * The new branch name
	 */
	newBranch: string
}

/**
 * Discriminated union of all GitWatcher event types
 */
export type GitWatcherEvent =
	| GitWatcherScanStartEvent
	| GitWatcherScanEndEvent
	| GitWatcherFileChangedEvent
	| GitWatcherFileDeletedEvent
	| GitWatcherBranchChangedEvent

/**
 * @deprecated Use GitWatcherEvent instead. This type alias is provided for backward compatibility.
 */
export type GitWatcherFileEvent = GitWatcherFileChangedEvent

/**
 * Git state snapshot for change detection
 */
interface GitStateSnapshot {
	branch: string
	commit: string
	isDetached: boolean
}

/**
 * GitWatcher - Monitors git repository and emits events
 *
 * Usage:
 * ```typescript
 * const watcher = new GitWatcher({ cwd: '/path/to/repo' })
 * watcher.onEvent((event) => {
 *   switch (event.type) {
 *     case 'scan-start':
 *       console.log(`Scan started on branch ${event.branch}`)
 *       break
 *     case 'file-changed':
 *       console.log(`File: ${event.filePath}, Hash: ${event.fileHash}`)
 *       break
 *     case 'file-deleted':
 *       console.log(`File deleted: ${event.filePath}`)
 *       break
 *     case 'scan-end':
 *       console.log(`Scan completed on branch ${event.branch}`)
 *       break
 *     case 'branch-changed':
 *       console.log(`Branch changed from ${event.previousBranch} to ${event.newBranch}`)
 *       break
 *   }
 * })
 * await watcher.scan()
 * ```
 */
export class GitWatcher implements vscode.Disposable {
	private readonly emitter: EventEmitter
	private readonly disposables: vscode.Disposable[] = []
	private currentState: GitStateSnapshot | null = null
	private isProcessing = false
	private defaultBranch: string | null = null

	constructor(public config: GitWatcherConfig) {
		this.config = config
		this.emitter = new EventEmitter()
	}

	/**
	 * Register a handler for all GitWatcher events
	 * @param handler Callback function that receives event data
	 */
	public onEvent(handler: (data: GitWatcherEvent) => void): void {
		this.emitter.on("event", handler)
	}

	/**
	 * @deprecated Use onEvent instead. This method is provided for backward compatibility.
	 */
	public onFile(handler: (data: GitWatcherFileChangedEvent) => void): void {
		this.emitter.on("event", (event: GitWatcherEvent) => {
			if (event.type === "file-changed") {
				handler(event)
			}
		})
	}

	/**
	 * Scan the repository and emit file events
	 *
	 * Behavior:
	 * - On default/main branch: Emits all tracked files
	 * - On feature branch: Emits only files that differ from default branch
	 */
	public async scan(): Promise<void> {
		try {
			// Check if in detached HEAD state
			if (await isDetachedHead(this.config.cwd)) {
				return
			}

			const currentBranch = await getCurrentBranch(this.config.cwd)
			const defaultBranch = await this.getDefaultBranch()

			// Determine if we're on the default branch
			const isOnDefaultBranch = currentBranch.toLowerCase() === defaultBranch.toLowerCase()

			if (isOnDefaultBranch) {
				// On default branch: emit all tracked files
				await this.scanAllFiles(currentBranch)
			} else {
				// On feature branch: emit only diff files
				await this.scanDiffFiles(currentBranch, defaultBranch)
			}
		} catch (error) {
			console.error("[GitWatcher] Error during scan:", error)
			throw error
		}
	}

	/**
	 * Dispose of the watcher and clean up resources
	 */
	public dispose(): void {
		this.emitter.removeAllListeners()
		for (const disposable of this.disposables) {
			disposable.dispose()
		}
		this.disposables.length = 0
	}

	/**
	 * Start monitoring git state changes
	 * Must be called after construction to begin watching for git changes
	 */
	public async start(): Promise<void> {
		try {
			// Get initial git state
			const isDetached = await isDetachedHead(this.config.cwd)
			if (!isDetached) {
				const [branch, commit] = await Promise.all([
					getCurrentBranch(this.config.cwd),
					getCurrentCommitSha(this.config.cwd),
				])
				this.currentState = { branch, commit, isDetached: false }
			}

			// Set up file system watchers for git state changes
			await this.setupGitWatchers()
		} catch (error) {
			console.error("[GitWatcher] Failed to initialize watcher:", error)
		}
	}

	/**
	 * Set up file system watchers for git state changes
	 */
	private async setupGitWatchers(): Promise<void> {
		try {
			const gitHeadPath = await getGitHeadPath(this.config.cwd)
			const absoluteGitHeadPath = path.isAbsolute(gitHeadPath)
				? gitHeadPath
				: path.join(this.config.cwd, gitHeadPath)

			// Watch .git/HEAD for branch switches and commits
			// We use fs.watch because vscode.workspace.createFileSystemWatcher ignores .git folder
			try {
				const headWatcher = fs.watch(absoluteGitHeadPath, () => {
					this.handleGitChange()
				})
				this.disposables.push(new vscode.Disposable(() => headWatcher.close()))
			} catch (error) {
				console.warn("[GitWatcher] Could not watch HEAD:", error)
			}

			// Watch branch refs for commits
			try {
				const gitDir = path.dirname(absoluteGitHeadPath)
				const refsHeadsPath = path.join(gitDir, "refs", "heads")

				if (fs.existsSync(refsHeadsPath)) {
					const refsWatcher = fs.watch(refsHeadsPath, { recursive: true }, () => {
						this.handleGitChange()
					})
					this.disposables.push(new vscode.Disposable(() => refsWatcher.close()))
				}
			} catch (error) {
				console.warn("[GitWatcher] Could not watch branch refs:", error)
			}

			// Watch packed-refs
			try {
				const gitDir = path.dirname(absoluteGitHeadPath)
				const packedRefsPath = path.join(gitDir, "packed-refs")

				if (fs.existsSync(packedRefsPath)) {
					const packedRefsWatcher = fs.watch(packedRefsPath, () => {
						this.handleGitChange()
					})
					this.disposables.push(new vscode.Disposable(() => packedRefsWatcher.close()))
				}
			} catch (error) {
				console.warn("[GitWatcher] Could not watch packed-refs:", error)
			}
		} catch (error) {
			console.error("[GitWatcher] Failed to setup git watchers:", error)
		}
	}

	/**
	 * Handle git state changes
	 */
	private async handleGitChange(): Promise<void> {
		if (this.isProcessing) {
			return
		}

		try {
			this.isProcessing = true

			// Check for detached HEAD
			if (await isDetachedHead(this.config.cwd)) {
				this.currentState = null
				return
			}

			// Get new git state
			const [branch, commit] = await Promise.all([
				getCurrentBranch(this.config.cwd),
				getCurrentCommitSha(this.config.cwd),
			])
			const newState: GitStateSnapshot = { branch, commit, isDetached: false }

			// Check if state actually changed
			if (this.currentState) {
				const branchChanged = this.currentState.branch !== newState.branch
				const commitChanged = this.currentState.commit !== newState.commit

				if (!branchChanged && !commitChanged) {
					return
				}

				// Emit branch-changed event if branch changed
				if (branchChanged) {
					const defaultBranch = await this.getDefaultBranch()
					const isBaseBranch = newState.branch.toLowerCase() === defaultBranch.toLowerCase()

					this.emitEvent({
						type: "branch-changed",
						previousBranch: this.currentState.branch,
						newBranch: newState.branch,
						branch: newState.branch,
						isBaseBranch,
						watcher: this,
					})
				}

				// Trigger scan on state change
				await this.scan()
			}

			this.currentState = newState
		} catch (error) {
			console.error("[GitWatcher] Error handling git change:", error)
		} finally {
			this.isProcessing = false
		}
	}

	/**
	 * Get the default branch name
	 */
	private async getDefaultBranch(): Promise<string> {
		if (this.defaultBranch) {
			return this.defaultBranch
		}

		if (this.config.defaultBranchOverride) {
			this.defaultBranch = this.config.defaultBranchOverride
			return this.defaultBranch
		}

		this.defaultBranch = await getBaseBranch(this.config.cwd)
		return this.defaultBranch
	}

	/**
	 * Helper method to emit events
	 * @param event The event data to emit
	 */
	private emitEvent(event: GitWatcherEvent): void {
		this.emitter.emit("event", event)
	}

	/**
	 * @deprecated Use emitEvent instead
	 */
	private emitFile(event: GitWatcherFileChangedEvent): void {
		this.emitEvent(event)
	}

	/**
	 * Scan all tracked files in the repository
	 */
	private async scanAllFiles(branch: string): Promise<void> {
		try {
			// Emit scan start event
			this.emitEvent({
				type: "scan-start",
				branch,
				isBaseBranch: true,
				watcher: this,
			})

			// Use git ls-files -s to get all tracked files with their hashes
			for await (const line of execGetLines({
				cmd: "git ls-files -s",
				cwd: this.config.cwd,
				context: "scanning git tracked files",
			})) {
				const trimmed = line.trim()
				if (!trimmed) continue

				// Parse git ls-files -s output
				// Format: <mode> <hash> <stage> <path>
				// Example: 100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0 README.md
				const parts = trimmed.split(/\s+/)
				if (parts.length < 4) continue

				const fileHash = parts[1]
				const filePath = parts.slice(3).join(" ") // Handle paths with spaces

				this.emitEvent({
					type: "file-changed",
					filePath,
					fileHash,
					branch,
					isBaseBranch: true,
					watcher: this,
				})
			}

			// Emit scan end event
			this.emitEvent({
				type: "scan-end",
				branch,
				isBaseBranch: true,
				watcher: this,
			})
		} catch (error) {
			console.error("[GitWatcher] Error scanning all files:", error)
			throw error
		}
	}

	/**
	 * Scan only files that differ from the default branch
	 */
	private async scanDiffFiles(currentBranch: string, defaultBranch: string): Promise<void> {
		try {
			// Emit scan start event
			this.emitEvent({
				type: "scan-start",
				branch: currentBranch,
				isBaseBranch: false,
				watcher: this,
			})

			// Get the diff between current branch and default branch
			const diff = await getGitDiff(currentBranch, defaultBranch, this.config.cwd)

			// Emit deleted file events
			for (const deletedFile of diff.deleted) {
				this.emitEvent({
					type: "file-deleted",
					filePath: deletedFile,
					branch: currentBranch,
					isBaseBranch: false,
					watcher: this,
				})
			}

			// Combine added and modified files (we only care about files that exist)
			const filesToScan = [...diff.added, ...diff.modified]

			if (filesToScan.length === 0) {
				// Emit scan end even if no files to scan
				this.emitEvent({
					type: "scan-end",
					branch: currentBranch,
					isBaseBranch: false,
					watcher: this,
				})
				return
			}

			// Build single command with all files (quote each to handle spaces)
			const quotedFiles = filesToScan.map((f) => `"${f}"`).join(" ")
			const cmd = `git ls-files -s ${quotedFiles}`

			// Execute once and parse all results
			for await (const line of execGetLines({
				cmd,
				cwd: this.config.cwd,
				context: "getting file hashes for diff files",
			})) {
				const trimmed = line.trim()
				if (!trimmed) continue

				// Parse git ls-files -s output
				// Format: <mode> <hash> <stage> <path>
				// Example: 100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0 README.md
				const parts = trimmed.split(/\s+/)
				if (parts.length < 4) continue

				const fileHash = parts[1]
				const filePath = parts.slice(3).join(" ") // Handle paths with spaces

				this.emitEvent({
					type: "file-changed",
					filePath,
					fileHash,
					branch: currentBranch,
					isBaseBranch: false,
					watcher: this,
				})
			}

			// Emit scan end event
			this.emitEvent({
				type: "scan-end",
				branch: currentBranch,
				isBaseBranch: false,
				watcher: this,
			})
		} catch (error) {
			console.error("[GitWatcher] Error scanning diff files:", error)
			throw error
		}
	}
}
