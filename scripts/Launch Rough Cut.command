#!/bin/zsh
set -e

SCRIPT_DIR="${0:A:h}"
if [ -f "$SCRIPT_DIR/../package.json" ]; then
	PROJECT_DIR="${SCRIPT_DIR:A:h}"
else
	PROJECT_DIR="$PWD"
fi
APP_URL="http://localhost:3000/automation/roughcut-gui"
HEALTH_URL="http://localhost:3000/automation/roughcut-gui"

echo "Starting Rough Cut..."
echo

if ! command -v bun >/dev/null 2>&1; then
	echo "Bun is not installed or is not on PATH."
	echo "Install Bun first: https://bun.sh"
	echo
	read "unused?Press Return to close this window."
	exit 1
fi

if [ ! -d "$PROJECT_DIR" ]; then
	echo "Could not find the project folder:"
	echo "$PROJECT_DIR"
	echo
	read "unused?Press Return to close this window."
	exit 1
fi

if [ ! -f "$PROJECT_DIR/package.json" ]; then
	echo "Could not find package.json in:"
	echo "$PROJECT_DIR"
	echo
	echo "Run this launcher from the repository's scripts folder."
	echo
	read "unused?Press Return to close this window."
	exit 1
fi

cd "$PROJECT_DIR"

if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
	echo "Rough Cut is already running."
	open "$APP_URL"
	echo
	echo "Opened $APP_URL"
	read "unused?Press Return to close this window."
	exit 0
fi

echo "Launching local server..."
bun run roughcut:gui &
SERVER_PID=$!

echo "Waiting for the app to be ready..."
for attempt in {1..60}; do
	if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
		echo "Opening Rough Cut..."
		open "$APP_URL"
		echo
		echo "The app is running. Keep this Terminal window open while using it."
		echo "Close this window when you are done."
		wait "$SERVER_PID"
		exit 0
	fi
	sleep 1
done

echo "The app did not become ready in time."
echo "Try running this again, or run this manually:"
echo "cd \"$PROJECT_DIR\" && bun run roughcut:gui"
kill "$SERVER_PID" >/dev/null 2>&1 || true
echo
read "unused?Press Return to close this window."
exit 1
