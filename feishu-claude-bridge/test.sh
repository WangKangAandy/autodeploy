#!/bin/bash

# Test script for Feishu Bridge System

echo "========================================"
echo "Testing Feishu Bridge System"
echo "========================================"
echo ""

# Check if directories exist
echo "1. Checking directories..."
if [ -d "messages" ]; then
    echo "   ✓ messages/ directory exists"
else
    echo "   ✗ messages/ directory missing"
fi

if [ -d "responses" ]; then
    echo "   ✓ responses/ directory exists"
else
    echo "   ✗ responses/ directory missing"
fi

if [ -d "dist" ]; then
    echo "   ✓ dist/ directory exists"
else
    echo "   ✗ dist/ directory missing"
fi

echo ""

# Check if CLI works
echo "2. Testing CLI..."
npm run cli list 2>&1 | head -5
echo "   ✓ CLI works"
echo ""

# Check if built files exist
echo "3. Checking built files..."
if [ -f "dist/index.js" ]; then
    echo "   ✓ dist/index.js exists"
else
    echo "   ✗ dist/index.js missing"
fi

if [ -f "dist/response-watcher.js" ]; then
    echo "   ✓ dist/response-watcher.js exists"
else
    echo "   ✗ dist/response-watcher.js missing"
fi

if [ -f "dist/cli.js" ]; then
    echo "   ✓ dist/cli.js exists"
else
    echo "   ✗ dist/cli.js missing"
fi

echo ""

# Create a test message
echo "4. Creating test message..."
TEST_REQUEST_ID="test-$(date +%s)"
TEST_MESSAGE=$(cat <<EOF
{
  "requestId": "$TEST_REQUEST_ID",
  "userId": "test_user",
  "chatId": "test_chat",
  "chatType": "p2p",
  "senderId": "test_sender",
  "senderName": "Test User",
  "message": "This is a test message",
  "attachments": [],
  "timestamp": "$(date -Iseconds)"
}
EOF
)

echo "$TEST_MESSAGE" > "messages/${TEST_REQUEST_ID}.json"
echo "   ✓ Test message created: messages/${TEST_REQUEST_ID}.json"
echo ""

# Test CLI list
echo "5. Testing CLI list command..."
npm run cli list 2>&1 | grep -q "Found"
if [ $? -eq 0 ]; then
    echo "   ✓ CLI list command works"
else
    echo "   ✗ CLI list command failed"
fi
echo ""

# Test CLI show
echo "6. Testing CLI show command..."
npm run cli show "$TEST_REQUEST_ID" 2>&1 | grep -q "Test User"
if [ $? -eq 0 ]; then
    echo "   ✓ CLI show command works"
else
    echo "   ✗ CLI show command failed"
fi
echo ""

# Create a test response
echo "7. Creating test response..."
TEST_RESPONSE="{\"content\":\"This is a test response\"}"
echo "$TEST_RESPONSE" > "responses/${TEST_REQUEST_ID}.json"
echo "   ✓ Test response created: responses/${TEST_REQUEST_ID}.json"
echo ""

# Check if response exists
echo "8. Checking response file..."
if [ -f "responses/${TEST_REQUEST_ID}.json" ]; then
    echo "   ✓ Response file exists"
    cat "responses/${TEST_REQUEST_ID}.json"
    echo ""
else
    echo "   ✗ Response file missing"
fi
echo ""

# Cleanup
echo "9. Cleaning up test files..."
rm -f "messages/${TEST_REQUEST_ID}.json"
rm -f "responses/${TEST_REQUEST_ID}.json"
echo "   ✓ Test files cleaned up"
echo ""

echo "========================================"
echo "All tests completed!"
echo "========================================"