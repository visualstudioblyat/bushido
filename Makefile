# Makefile — build bushido (digidaw-space) for Windows
#
# The app links webview2-com / windows crates, so the Windows build MUST use
# the MSVC target (x86_64-pc-windows-msvc). On Linux we cross-compile with
# cargo-xwin; on Windows we build natively.
#
#   make win-setup   # one-time: install target + tooling
#   make win         # cross-compile Windows build from Linux
#   make win-native  # build on a real Windows machine
#   make clean

TARGET      := x86_64-pc-windows-msvc
TAURI       := npm run tauri --
SRC_TAURI   := src-tauri

# LLVM toolchain cargo-xwin drives (clang-cl, lld-link, llvm-lib).
# Debian/Ubuntu ship these under a versioned bin dir, not plain names on PATH.
# clang has no `clang-cl` binary on Debian; .toolchain-bin/clang-cl symlinks it.
LLVM_BIN    := /usr/lib/llvm-18/bin
LOCAL_BIN   := $(CURDIR)/.toolchain-bin
XWIN_ENV    := PATH="$(LOCAL_BIN):$(LLVM_BIN):$(PATH)" \
               CC_x86_64_pc_windows_msvc="clang-cl" \
               CXX_x86_64_pc_windows_msvc="clang-cl" \
               AR_x86_64_pc_windows_msvc="llvm-lib"

.DEFAULT_GOAL := win

# ---------------------------------------------------------------------------
# One-time setup
# ---------------------------------------------------------------------------
.PHONY: win-setup
win-setup:
	rustup target add $(TARGET)
	cargo install --locked cargo-xwin
	npm install
	mkdir -p $(LOCAL_BIN)
	ln -sf "$$(which clang)" $(LOCAL_BIN)/clang-cl
	@echo ""
	@echo ">> Also install the LLVM tools cargo-xwin needs (needs sudo):"
	@echo "   sudo apt-get install -y clang lld-18 llvm-18"
	@echo "   (provides clang-cl, lld-link, llvm-lib under $(LLVM_BIN))"

# ---------------------------------------------------------------------------
# Frontend (shared by all build paths)
# ---------------------------------------------------------------------------
.PHONY: frontend
frontend:
	npm run build

# ---------------------------------------------------------------------------
# Cross-compile from Linux using cargo-xwin as the linker/runner.
# cargo-xwin downloads the MSVC CRT + Windows SDK headers automatically.
# ---------------------------------------------------------------------------
.PHONY: win
win: frontend
	cd $(SRC_TAURI) && $(XWIN_ENV) \
	  cargo xwin build --release --target $(TARGET) --no-default-features
	@echo ""
	@echo "Built: $(SRC_TAURI)/target/$(TARGET)/release/digidaw-space.exe"
	@echo "(Run 'make win-bundle' on Windows to produce an installer.)"

# Full Tauri bundle (installer) — reliable only on native Windows,
# since NSIS/WiX bundling expects a Windows host.
.PHONY: win-bundle
win-bundle: frontend
	$(TAURI) build --target $(TARGET)

# ---------------------------------------------------------------------------
# Native build on a Windows machine (MSVC toolchain installed)
# ---------------------------------------------------------------------------
.PHONY: win-native
win-native:
	npm install
	npm run build
	$(TAURI) build

# ---------------------------------------------------------------------------
.PHONY: clean
clean:
	cd $(SRC_TAURI) && cargo clean
	rm -rf dist
