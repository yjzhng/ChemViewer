.PHONY: install desktop desktop-install web build

# Install root (web) dependencies.
install:
	npm install

# Install the desktop shell's Electron (one-time, ~100 MB).
desktop-install:
	npm --prefix desktop install

# Launch the from-source Electron desktop app (Vite + window, with port guard).
# Auto-installs Electron on first run.
desktop:
	@[ -d desktop/node_modules/electron ] || $(MAKE) desktop-install
	node desktop/scripts/dev.mjs

# Plain browser dev server.
web:
	npm run dev

# Production web build.
build:
	npm run build
