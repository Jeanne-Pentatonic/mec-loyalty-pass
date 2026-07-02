#!/bin/bash
# Local testing helper for Pentatonic Wallet

BASE_URL="https://localhost:3000"
CURL="curl -sk"

case "$1" in
  pass)
    # Generate a new pass and save it
    echo "Generating new pass..."
    $CURL -o ~/Desktop/pentatonic-pass.pkpass "$BASE_URL/pass"
    echo "Pass saved to ~/Desktop/pentatonic-pass.pkpass"
    echo "Opening pass..."
    open ~/Desktop/pentatonic-pass.pkpass
    ;;

  member)
    # Get member info
    if [ -z "$2" ]; then
      echo "Usage: ./test-local.sh member <member-id>"
      exit 1
    fi
    echo "Member info for $2:"
    $CURL "$BASE_URL/api/members/$2" | python3 -m json.tool
    ;;

  add-points)
    # Add points to a member
    if [ -z "$2" ] || [ -z "$3" ]; then
      echo "Usage: ./test-local.sh add-points <member-id> <points> [reason]"
      exit 1
    fi
    REASON="${4:-Manual adjustment}"
    echo "Adding $3 points to $2..."
    $CURL -X POST "$BASE_URL/api/members/$2/points" \
      -H "Content-Type: application/json" \
      -d "{\"points\": $3, \"reason\": \"$REASON\"}" | python3 -m json.tool
    ;;

  refresh)
    # Download updated pass for existing member
    if [ -z "$2" ]; then
      echo "Usage: ./test-local.sh refresh <member-id>"
      exit 1
    fi
    echo "Downloading updated pass for $2..."
    # Get auth token from member (for testing only - normally the device does this)
    $CURL -o ~/Desktop/pentatonic-pass-updated.pkpass "$BASE_URL/pass?refresh=$2"
    echo "Updated pass saved. Opening..."
    open ~/Desktop/pentatonic-pass-updated.pkpass
    ;;

  *)
    echo "Pentatonic Wallet Local Test Helper"
    echo ""
    echo "Commands:"
    echo "  ./test-local.sh pass              - Generate & open a new pass"
    echo "  ./test-local.sh member <id>       - View member info & points"
    echo "  ./test-local.sh add-points <id> <points> [reason]  - Add points"
    echo ""
    echo "Example workflow:"
    echo "  1. ./test-local.sh pass           # Creates new member, opens pass"
    echo "  2. Copy the member ID from the pass (back of card)"
    echo "  3. ./test-local.sh add-points <id> 500 'Welcome bonus'"
    echo "  4. ./test-local.sh member <id>    # Check points were added"
    ;;
esac
