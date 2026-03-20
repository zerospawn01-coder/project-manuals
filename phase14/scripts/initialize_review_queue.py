#!/usr/bin/env python3
"""
Phase14 Review Queue Initialization
Initializes the review queue with candidates prioritized by priority_score.
"""

import pandas as pd
from pathlib import Path
from datetime import datetime

def initialize_review_queue(candidate_snapshot_path, output_file=None):
    """
    Initialize review queue from candidate snapshot.
    Queue is ordered by priority_score (highest first).
    """
    
    # Load candidate snapshot
    df_candidates = pd.read_csv(candidate_snapshot_path)
    
    # Create review queue: candidates are already sorted by priority_score
    review_queue = []
    
    for idx, row in df_candidates.iterrows():
        queue_item = {
            'queue_position': idx + 1,
            'candidate_id': row['candidate_id'],
            'priority_score': row['priority_score'],
            'cluster_id': int(row['cluster_id']),
            'product_category': row['product_category'],
            'status': 'pending',
            'assigned_reviewer': None,
            'review_completion_time': None,
            'reviewer_decision': None,  # approve/reject
            'queued_at': datetime.now().isoformat(),
        }
        review_queue.append(queue_item)
    
    # Convert to DataFrame
    df_queue = pd.DataFrame(review_queue)
    
    # Save review queue
    if output_file is None:
        output_file = Path(candidate_snapshot_path).parent / "review_queue.csv"
    
    df_queue.to_csv(output_file, index=False)
    
    print(f"✓ Initialized review queue with {len(df_queue)} items")
    print(f"  Output file: {output_file}")
    print(f"\nQueue preview (top 10):")
    print(df_queue.head(10)[['queue_position', 'candidate_id', 'priority_score', 'status']])
    
    return output_file

if __name__ == "__main__":
    candidate_file = Path(__file__).parent.parent / "data" / "candidate_snapshot.csv"
    
    if not candidate_file.exists():
        print(f"Error: {candidate_file} not found")
        exit(1)
    
    initialize_review_queue(str(candidate_file))
