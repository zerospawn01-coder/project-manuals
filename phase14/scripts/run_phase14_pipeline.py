#!/usr/bin/env python3
"""
Phase14 Pipeline Orchestrator
Runs the complete Phase14 pipeline: clustering -> rule mining -> candidate generation -> queue init
"""

import sys
import traceback
import importlib
from pathlib import Path

# Add scripts directory to path for imports
scripts_dir = Path(__file__).parent
sys.path.insert(0, str(scripts_dir))

if __package__:
    from .generate_dummy_data import generate_dummy_data
    from .rule_mining import extract_rule_features
    from .generate_candidates import generate_candidates
    from .initialize_review_queue import initialize_review_queue
else:
    generate_dummy_data = importlib.import_module('generate_dummy_data').generate_dummy_data
    extract_rule_features = importlib.import_module('rule_mining').extract_rule_features
    generate_candidates = importlib.import_module('generate_candidates').generate_candidates
    initialize_review_queue = importlib.import_module('initialize_review_queue').initialize_review_queue

def run_phase14_pipeline():
    """
    Execute the complete Phase14 pipeline.
    
    Stages:
    1. Generate dummy clustering data
    2. Mine rules from clustering output
    3. Generate candidates with priority scores
    4. Initialize review queue
    """
    
    print("=" * 60)
    print("Phase14 Pipeline Execution")
    print("=" * 60)
    
    data_dir = Path(__file__).parent.parent / "data"
    
    try:
        # Stage 1: Generate dummy data
        print("\n[Stage 1] Generating clustering output...")
        clustering_file = generate_dummy_data()
        assert clustering_file.exists(), f"Clustering file not created: {clustering_file}"
        print("✓ Stage 1 complete\n")
        
        # Stage 2: Extract rule features (for validation)
        print("[Stage 2] Mining rules from clustering output...")
        rule_stats = extract_rule_features(str(clustering_file))
        print(f"✓ Extracted {rule_stats['total_rules']} rules")
        print(f"  Average confidence: {rule_stats['avg_confidence']:.2f}")
        print(f"  Average lift: {rule_stats['avg_lift']:.2f}")
        print("✓ Stage 2 complete\n")
        
        # Stage 3: Generate candidates
        print("[Stage 3] Generating candidate snapshot...")
        candidate_file = generate_candidates(str(clustering_file))
        assert candidate_file.exists(), f"Candidate file not created: {candidate_file}"
        print("✓ Stage 3 complete\n")
        
        # Stage 4: Initialize review queue
        print("[Stage 4] Initializing review queue...")
        queue_file = initialize_review_queue(str(candidate_file))
        assert queue_file.exists(), f"Queue file not created: {queue_file}"
        print("✓ Stage 4 complete\n")
        
        # Validation
        print("=" * 60)
        print("Pipeline Execution Summary")
        print("=" * 60)
        print(f"✓ clustering_output.csv: {clustering_file}")
        print(f"✓ candidate_snapshot.csv: {candidate_file}")
        print(f"✓ review_queue.csv: {queue_file}")
        print("\n✓ Pipeline completed successfully!")
        print("=" * 60)
        
        return True
        
    except Exception as e:
        print(f"\n❌ Pipeline failed at stage:")
        print(f"Error: {str(e)}")
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = run_phase14_pipeline()
    sys.exit(0 if success else 1)
