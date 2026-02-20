"""
Test script for Behavior Agent - validates DB connection and metric computation.
Run: python -m agents.test_behavior_agent
"""
import os
import sys
import json
import unittest
from dotenv import load_dotenv

# Ensure we can import modules from the parent directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents.behavior_agent import compute_behavior_metrics, _extract_user_id


class TestBehaviorAgent(unittest.TestCase):

    def setUp(self):
        load_dotenv()

    def test_extract_user_id(self):
        """Test user ID extraction from various query formats."""
        self.assertEqual(_extract_user_id("Check behavior for user_id=Bad_Trader"), "Bad_Trader")
        self.assertEqual(_extract_user_id("Check behavior for user_id='Good_Trader'"), "Good_Trader")
        self.assertEqual(_extract_user_id("Analyze bad trader behavior"), "Bad_Trader")
        self.assertEqual(_extract_user_id("Am I tilting?"), "Good_Trader")  # default

    def test_good_trader_metrics(self):
        """Test real DB connection and metrics for Good_Trader."""
        user_id = "Good_Trader"
        print(f"\n{'='*60}")
        print(f"[TEST] Testing Behavior Agent with User ID: {user_id}")
        print(f"{'='*60}")

        result = compute_behavior_metrics(user_id=user_id)

        # Basic structure validation
        self.assertIsInstance(result, dict, "Result should be a dictionary")
        self.assertEqual(result["user_id"], user_id)

        if "error" in result:
            self.fail(f"Agent returned an error: {result['error']}")

        # Verify required fields for frontend card
        required_fields = ["tilt_score", "status", "block_trade", "coach_message",
                           "current_state", "patterns", "current_asset_context"]
        for field in required_fields:
            self.assertIn(field, result, f"Missing required field: {field}")

        # Verify deterministic score is a valid number
        self.assertIsInstance(result["tilt_score"], int)
        self.assertGreaterEqual(result["tilt_score"], 0)
        self.assertLessEqual(result["tilt_score"], 100)

        # Verify status is valid
        self.assertIn(result["status"], ["CRITICAL", "WARNING", "NORMAL"])

        # Print detailed results
        print(f"\n[SUCCESS] Metrics for {user_id}:")
        print(f"  Tilt Score: {result['tilt_score']}")
        print(f"  Status: {result['status']}")
        print(f"  Block Trade: {result['block_trade']}")
        print(f"  Loss Streak: {result['current_state']['current_loss_streak']}")
        print(f"  Last Result: {result['current_state']['last_result']}")
        print(f"  Revenge Risk: {result['current_state']['is_revenge_trading_risk']}")
        print(f"  Toxic Asset: {result['patterns']['toxic_asset']}")
        print(f"  Trade Count: {result.get('trade_count', 'N/A')}")
        print(f"  Coach Message: {result['coach_message']}")

        if "daily_metrics" in result:
            dm = result["daily_metrics"]
            print(f"  Daily Trades: {dm['daily_trade_count']}/{dm['max_daily_trades']}")
            print(f"  Daily P&L: ${dm['daily_pnl']:.2f} (max loss: ${dm['max_daily_loss']:.2f})")

        if "overall_stats" in result:
            stats = result["overall_stats"]
            print(f"  Win Rate: {stats['win_rate']}%")
            print(f"  Total P&L: ${stats['total_pnl']:.2f}")

        if result.get("violations"):
            print(f"  Violations: {result['violations']}")

        if result.get("constraints"):
            print(f"  Constraints: {json.dumps(result['constraints'])}")

    def test_bad_trader_metrics(self):
        """Test real DB connection and metrics for Bad_Trader."""
        user_id = "Bad_Trader"
        print(f"\n{'='*60}")
        print(f"[TEST] Testing Behavior Agent with User ID: {user_id}")
        print(f"{'='*60}")

        result = compute_behavior_metrics(user_id=user_id)

        self.assertIsInstance(result, dict)
        self.assertEqual(result["user_id"], user_id)

        if "error" in result:
            self.fail(f"Agent returned an error: {result['error']}")

        # Bad Trader should generally have higher tilt scores
        print(f"\n[SUCCESS] Metrics for {user_id}:")
        print(f"  Tilt Score: {result['tilt_score']}")
        print(f"  Status: {result['status']}")
        print(f"  Loss Streak: {result['current_state']['current_loss_streak']}")
        print(f"  Trade Count: {result.get('trade_count', 'N/A')}")
        print(f"  Coach Message: {result['coach_message']}")

        if "overall_stats" in result:
            stats = result["overall_stats"]
            print(f"  Win Rate: {stats['win_rate']}%")
            print(f"  Total P&L: ${stats['total_pnl']:.2f}")

    def test_nonexistent_user(self):
        """Test graceful handling of non-existent user."""
        result = compute_behavior_metrics(user_id="NonExistent_User_12345")
        self.assertIsInstance(result, dict)
        self.assertEqual(result["tilt_score"], 0)
        self.assertEqual(result["status"], "NORMAL")
        print(f"\n[SUCCESS] Non-existent user handled gracefully: {result.get('note', 'No note')}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
