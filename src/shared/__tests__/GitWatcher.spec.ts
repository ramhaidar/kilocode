// kilocode_change - new file
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "events"
import * as vscode from "vscode"
import * as fs from "fs"
import { GitWatcher, GitWatcherConfig, GitWatcherEvent, GitWatcherFileChangedEvent } from "../GitWatcher"
import * as exec from "../utils/exec"
import * as gitUtils from "../../services/code-index/managed/git-utils"

// Mock vscode
vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(() => ({
			onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
			dispose: vi.fn(),
		})),
	},
	Disposable: class {
		constructor(public dispose: () => any) {}
		static from(...disposables: { dispose: () => any }[]) {
			return {
				dispose: () => disposables.forEach((d) => d.dispose()),
			}
		}
	},
}))

// Mock fs
vi.mock("fs", async () => {
	const actual = await vi.importActual<typeof import("fs")>("fs")
	return {
		...actual,
		watch: vi.fn().mockReturnValue({ close: vi.fn() }),
		existsSync: vi.fn().mockReturnValue(true),
	}
})

// Mock exec utilities
vi.mock("../utils/exec")

// Mock git utilities
vi.mock("../../services/code-index/managed/git-utils")

describe("GitWatcher", () => {
	let config: GitWatcherConfig
	let mockExecGetLines: ReturnType<typeof vi.fn>
	let mockGetCurrentBranch: ReturnType<typeof vi.fn>
	let mockGetCurrentCommitSha: ReturnType<typeof vi.fn>
	let mockGetGitHeadPath: ReturnType<typeof vi.fn>
	let mockIsDetachedHead: ReturnType<typeof vi.fn>
	let mockGetBaseBranch: ReturnType<typeof vi.fn>
	let mockGetGitDiff: ReturnType<typeof vi.fn>

	beforeEach(() => {
		config = {
			cwd: "/test/repo",
		}

		// Setup mocks
		mockExecGetLines = vi.fn()
		mockGetCurrentBranch = vi.fn()
		mockGetCurrentCommitSha = vi.fn()
		mockGetGitHeadPath = vi.fn()
		mockIsDetachedHead = vi.fn()
		mockGetBaseBranch = vi.fn()
		mockGetGitDiff = vi.fn()

		vi.mocked(exec.execGetLines).mockImplementation(mockExecGetLines)
		vi.mocked(gitUtils.getCurrentBranch).mockImplementation(mockGetCurrentBranch)
		vi.mocked(gitUtils.getCurrentCommitSha).mockImplementation(mockGetCurrentCommitSha)
		vi.mocked(gitUtils.getGitHeadPath).mockImplementation(mockGetGitHeadPath)
		vi.mocked(gitUtils.isDetachedHead).mockImplementation(mockIsDetachedHead)
		vi.mocked(gitUtils.getBaseBranch).mockImplementation(mockGetBaseBranch)
		vi.mocked(gitUtils.getGitDiff).mockImplementation(mockGetGitDiff)

		// Default mock implementations
		mockIsDetachedHead.mockResolvedValue(false)
		mockGetCurrentBranch.mockResolvedValue("main")
		mockGetCurrentCommitSha.mockResolvedValue("abc123")
		mockGetGitHeadPath.mockResolvedValue(".git/HEAD")
		mockGetBaseBranch.mockResolvedValue("main")
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should create a GitWatcher instance", () => {
			const watcher = new GitWatcher(config)
			expect(watcher).toBeInstanceOf(GitWatcher)
			watcher.dispose()
		})

		it("should accept defaultBranchOverride in config", () => {
			const configWithOverride: GitWatcherConfig = {
				cwd: "/test/repo",
				defaultBranchOverride: "develop",
			}
			const watcher = new GitWatcher(configWithOverride)
			expect(watcher).toBeInstanceOf(GitWatcher)
			watcher.dispose()
		})
	})

	describe("onEvent", () => {
		it("should register an event handler", () => {
			const watcher = new GitWatcher(config)
			const handler = vi.fn()

			watcher.onEvent(handler)

			// Verify handler is registered by emitting an event
			const testEvent: GitWatcherFileChangedEvent = {
				type: "file-changed",
				filePath: "test.ts",
				fileHash: "abc123",
				branch: "main",
				isBaseBranch: true,
				watcher,
			}

			// Access the private emitter to test
			;(watcher as any).emitter.emit("event", testEvent)

			expect(handler).toHaveBeenCalledWith(testEvent)
			watcher.dispose()
		})

		it("should allow multiple handlers", () => {
			const watcher = new GitWatcher(config)
			const handler1 = vi.fn()
			const handler2 = vi.fn()

			watcher.onEvent(handler1)
			watcher.onEvent(handler2)

			const testEvent: GitWatcherFileChangedEvent = {
				type: "file-changed",
				filePath: "test.ts",
				fileHash: "abc123",
				branch: "main",
				isBaseBranch: true,
				watcher,
			}

			;(watcher as any).emitter.emit("event", testEvent)

			expect(handler1).toHaveBeenCalledWith(testEvent)
			expect(handler2).toHaveBeenCalledWith(testEvent)
			watcher.dispose()
		})

		it("should emit scan-start and scan-end events", () => {
			const watcher = new GitWatcher(config)
			const handler = vi.fn()

			watcher.onEvent(handler)

			const scanStartEvent: GitWatcherEvent = {
				type: "scan-start",
				branch: "main",
				isBaseBranch: true,
				watcher,
			}

			const scanEndEvent: GitWatcherEvent = {
				type: "scan-end",
				branch: "main",
				isBaseBranch: true,
				watcher,
			}

			;(watcher as any).emitter.emit("event", scanStartEvent)
			;(watcher as any).emitter.emit("event", scanEndEvent)

			expect(handler).toHaveBeenCalledWith(scanStartEvent)
			expect(handler).toHaveBeenCalledWith(scanEndEvent)
			watcher.dispose()
		})

		it("should emit file-deleted events", () => {
			const watcher = new GitWatcher(config)
			const handler = vi.fn()

			watcher.onEvent(handler)

			const deleteEvent: GitWatcherEvent = {
				type: "file-deleted",
				filePath: "deleted.ts",
				branch: "feature/test",
				isBaseBranch: false,
				watcher,
			}

			;(watcher as any).emitter.emit("event", deleteEvent)

			expect(handler).toHaveBeenCalledWith(deleteEvent)
			watcher.dispose()
		})

		it("should emit branch-changed events", () => {
			const watcher = new GitWatcher(config)
			const handler = vi.fn()

			watcher.onEvent(handler)

			const branchChangedEvent: GitWatcherEvent = {
				type: "branch-changed",
				previousBranch: "main",
				newBranch: "feature/test",
				branch: "feature/test",
				isBaseBranch: false,
				watcher,
			}

			;(watcher as any).emitter.emit("event", branchChangedEvent)

			expect(handler).toHaveBeenCalledWith(branchChangedEvent)
			watcher.dispose()
		})
	})

	describe("onFile (deprecated)", () => {
		it("should still work for backward compatibility", () => {
			const watcher = new GitWatcher(config)
			const handler = vi.fn()

			watcher.onFile(handler)

			// Emit a file-changed event
			const testEvent: GitWatcherFileChangedEvent = {
				type: "file-changed",
				filePath: "test.ts",
				fileHash: "abc123",
				branch: "main",
				isBaseBranch: true,
				watcher,
			}

			;(watcher as any).emitter.emit("event", testEvent)

			expect(handler).toHaveBeenCalledWith(testEvent)
			watcher.dispose()
		})

		it("should only receive file-changed events", () => {
			const watcher = new GitWatcher(config)
			const handler = vi.fn()

			watcher.onFile(handler)

			// Emit various event types
			;(watcher as any).emitter.emit("event", {
				type: "scan-start",
				branch: "main",
				isBaseBranch: true,
				watcher,
			})
			;(watcher as any).emitter.emit("event", {
				type: "file-changed",
				filePath: "test.ts",
				fileHash: "abc123",
				branch: "main",
				isBaseBranch: true,
				watcher,
			})
			;(watcher as any).emitter.emit("event", {
				type: "scan-end",
				branch: "main",
				isBaseBranch: true,
				watcher,
			})

			// Should only be called once for file-changed event
			expect(handler).toHaveBeenCalledTimes(1)
			watcher.dispose()
		})
	})

	describe("start", () => {
		it("should initialize git state monitoring", async () => {
			const watcher = new GitWatcher(config)
			await watcher.start()

			expect(mockGetCurrentBranch).toHaveBeenCalled()
			expect(mockGetCurrentCommitSha).toHaveBeenCalled()
			expect(mockGetGitHeadPath).toHaveBeenCalled()

			watcher.dispose()
		})

		it("should handle detached HEAD state during initialization", async () => {
			mockIsDetachedHead.mockResolvedValue(true)

			const watcher = new GitWatcher(config)
			await watcher.start()

			// Should not throw and should handle gracefully
			expect(mockGetCurrentBranch).not.toHaveBeenCalled()

			watcher.dispose()
		})
	})

	describe("scan", () => {
		it("should scan all files when on default branch", async () => {
			mockGetCurrentBranch.mockResolvedValue("main")
			mockGetBaseBranch.mockResolvedValue("main")

			// Mock git ls-files -s output
			const mockLines = [
				"100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0 README.md",
				"100644 a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0 0 src/index.ts",
			]

			mockExecGetLines.mockImplementation(async function* () {
				for (const line of mockLines) {
					yield line
				}
			})

			const watcher = new GitWatcher(config)
			const handler = vi.fn()
			watcher.onEvent(handler)

			await watcher.scan()

			// Should emit: scan-start, file-changed (x2), scan-end
			expect(handler).toHaveBeenCalledTimes(4)

			// Check scan-start event
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "scan-start",
					branch: "main",
					isBaseBranch: true,
				}),
			)

			// Check file-changed events
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "file-changed",
					filePath: "README.md",
					fileHash: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
					branch: "main",
					isBaseBranch: true,
				}),
			)
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "file-changed",
					filePath: "src/index.ts",
					fileHash: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0",
					branch: "main",
					isBaseBranch: true,
				}),
			)

			// Check scan-end event
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "scan-end",
					branch: "main",
					isBaseBranch: true,
				}),
			)

			watcher.dispose()
		})

		it("should scan only diff files when on feature branch", async () => {
			mockGetCurrentBranch.mockResolvedValue("feature/test")
			mockGetBaseBranch.mockResolvedValue("main")
			mockGetGitDiff.mockResolvedValue({
				added: ["new-file.ts"],
				modified: ["existing-file.ts"],
				deleted: [],
			})

			// Mock git ls-files -s output for batched command
			mockExecGetLines.mockImplementation(async function* () {
				yield "100644 abc123 0 new-file.ts"
				yield "100644 def456 0 existing-file.ts"
			})

			const watcher = new GitWatcher(config)
			const handler = vi.fn()
			watcher.onEvent(handler)

			await watcher.scan()

			// Verify single batched command was used
			expect(mockExecGetLines).toHaveBeenCalledTimes(1)
			expect(mockExecGetLines).toHaveBeenCalledWith({
				cmd: 'git ls-files -s "new-file.ts" "existing-file.ts"',
				cwd: config.cwd,
				context: "getting file hashes for diff files",
			})

			// Should emit: scan-start, file-changed (x2), scan-end
			expect(handler).toHaveBeenCalledTimes(4)

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "file-changed",
					filePath: "new-file.ts",
					fileHash: "abc123",
					branch: "feature/test",
					isBaseBranch: false,
				}),
			)
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "file-changed",
					filePath: "existing-file.ts",
					fileHash: "def456",
					branch: "feature/test",
					isBaseBranch: false,
				}),
			)

			watcher.dispose()
		})

		it("should not scan when in detached HEAD state", async () => {
			mockIsDetachedHead.mockResolvedValue(true)

			const watcher = new GitWatcher(config)
			const handler = vi.fn()
			watcher.onEvent(handler)

			await watcher.scan()

			expect(handler).not.toHaveBeenCalled()
			watcher.dispose()
		})

		it("should handle files with spaces in path", async () => {
			mockGetCurrentBranch.mockResolvedValue("main")
			mockGetBaseBranch.mockResolvedValue("main")

			const mockLines = ["100644 abc123 0 path with spaces/file.ts"]

			mockExecGetLines.mockImplementation(async function* () {
				for (const line of mockLines) {
					yield line
				}
			})

			const watcher = new GitWatcher(config)
			const handler = vi.fn()
			watcher.onEvent(handler)

			await watcher.scan()

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "file-changed",
					filePath: "path with spaces/file.ts",
					fileHash: "abc123",
					branch: "main",
				}),
			)

			watcher.dispose()
		})

		it("should use defaultBranchOverride when provided", async () => {
			const configWithOverride: GitWatcherConfig = {
				cwd: "/test/repo",
				defaultBranchOverride: "develop",
			}

			mockGetCurrentBranch.mockResolvedValue("develop")

			const mockLines = ["100644 abc123 0 test.ts"]

			mockExecGetLines.mockImplementation(async function* () {
				for (const line of mockLines) {
					yield line
				}
			})

			const watcher = new GitWatcher(configWithOverride)
			const handler = vi.fn()
			watcher.onEvent(handler)

			await watcher.scan()

			// Should scan all files since we're on the default branch (develop)
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "file-changed",
					filePath: "test.ts",
					fileHash: "abc123",
					branch: "develop",
					isBaseBranch: true,
				}),
			)

			// getBaseBranch should not be called since we have an override
			expect(mockGetBaseBranch).not.toHaveBeenCalled()

			watcher.dispose()
		})
	})

	describe("dispose", () => {
		it("should clean up resources", () => {
			const watcher = new GitWatcher(config)
			const handler = vi.fn()
			watcher.onFile(handler)

			watcher.dispose()

			// Emit event after disposal - handler should not be called
			;(watcher as any).emitter.emit("file", {
				filePath: "test.ts",
				fileHash: "abc123",
				branch: "main",
			})

			expect(handler).not.toHaveBeenCalled()
		})

		it("should dispose all file system watchers", async () => {
			const mockClose = vi.fn()
			vi.mocked(fs.watch).mockReturnValue({
				close: mockClose,
			} as any)
			vi.mocked(fs.existsSync).mockReturnValue(true)

			const watcher = new GitWatcher(config)
			await watcher.start()
			watcher.dispose()

			// Should have disposed watchers (HEAD, refs, packed-refs)
			expect(mockClose).toHaveBeenCalledTimes(3)
		})
	})

	describe("git state monitoring", () => {
		it("should handle branch changes", async () => {
			mockGetCurrentBranch.mockResolvedValueOnce("main").mockResolvedValueOnce("feature/test")
			mockGetCurrentCommitSha.mockResolvedValueOnce("abc123").mockResolvedValueOnce("abc123")
			mockGetBaseBranch.mockResolvedValue("main")

			const watcher = new GitWatcher(config)
			const handler = vi.fn()
			watcher.onEvent(handler)

			await watcher.start()

			// Mock scan to avoid actual git operations
			const scanSpy = vi.spyOn(watcher as any, "scan").mockResolvedValue(undefined)

			// Simulate branch change by calling handleGitChange
			await (watcher as any).handleGitChange()

			// Should emit branch-changed event
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "branch-changed",
					previousBranch: "main",
					newBranch: "feature/test",
					branch: "feature/test",
					isBaseBranch: false,
				}),
			)

			// Should trigger scan after branch change
			expect(scanSpy).toHaveBeenCalled()

			watcher.dispose()
		})

		it("should not emit branch-changed event when only commit changes", async () => {
			mockGetCurrentBranch.mockResolvedValue("main")
			mockGetCurrentCommitSha.mockResolvedValueOnce("abc123").mockResolvedValueOnce("def456")

			const watcher = new GitWatcher(config)
			const handler = vi.fn()
			watcher.onEvent(handler)

			await watcher.start()

			// Mock scan to avoid actual git operations
			const scanSpy = vi.spyOn(watcher as any, "scan").mockResolvedValue(undefined)

			// Simulate commit change (same branch)
			await (watcher as any).handleGitChange()

			// Should NOT emit branch-changed event
			const branchChangedCalls = handler.mock.calls.filter((call) => call[0].type === "branch-changed")
			expect(branchChangedCalls).toHaveLength(0)

			// Should still trigger scan
			expect(scanSpy).toHaveBeenCalled()

			watcher.dispose()
		})

		it("should handle commit changes", async () => {
			mockGetCurrentBranch.mockResolvedValueOnce("main").mockResolvedValueOnce("main")
			mockGetCurrentCommitSha.mockResolvedValueOnce("abc123").mockResolvedValueOnce("def456")

			const watcher = new GitWatcher(config)
			await watcher.start()

			// Simulate commit change
			await (watcher as any).handleGitChange()

			watcher.dispose()
		})

		it("should not process changes when already processing", async () => {
			const watcher = new GitWatcher(config)

			// Set processing flag
			;(watcher as any).isProcessing = true

			// Try to handle change - should return early
			await (watcher as any).handleGitChange()

			// Processing flag should still be true
			expect((watcher as any).isProcessing).toBe(true)

			watcher.dispose()
		})
	})

	describe("error handling", () => {
		it("should handle errors during scan", async () => {
			mockExecGetLines.mockImplementation(async function* () {
				throw new Error("Git command failed")
			})

			const watcher = new GitWatcher(config)

			await expect(watcher.scan()).rejects.toThrow("Git command failed")

			watcher.dispose()
		})

		it("should handle errors when getting file hash in diff mode", async () => {
			mockGetCurrentBranch.mockResolvedValue("feature/test")
			mockGetBaseBranch.mockResolvedValue("main")
			mockGetGitDiff.mockResolvedValue({
				added: ["file1.ts"],
				modified: [],
				deleted: [],
			})

			// Mock command failure
			mockExecGetLines.mockImplementation(async function* () {
				throw new Error("Git command failed")
			})

			const watcher = new GitWatcher(config)
			const handler = vi.fn()
			watcher.onFile(handler)

			// Should throw since the batched command fails
			await expect(watcher.scan()).rejects.toThrow("Git command failed")

			expect(handler).not.toHaveBeenCalled()

			watcher.dispose()
		})
	})
})
