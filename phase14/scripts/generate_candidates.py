#!/usr/bin/env python3
"""
Phase14 Candidate Generation
Generates candidate_snapshot.csv from clustering and rule mining outputs.
"""

import pandas as pd
import numpy as np
from pathlib import Path
import importlib

if __package__:
    from .rule_mining import mine_rules, extract_rule_features
else:
    _rule_mining = importlib.import_module('rule_mining')
    mine_rules = _rule_mining.mine_rules
    extract_rule_features = _rule_mining.extract_rule_features

def generate_candidates(clustering_output_path, output_file=None):
    """
    Generate candidates for review based on clustering and rules.
    Outputs candidate_snapshot.csv with candidates sorted by priority_score descending.
    """
    
    # Load clustering output
    df_clustering = pd.read_csv(clustering_output_path)
    
    # Extract rule features
    rule_stats = extract_rule_features(clustering_output_path)
    
    # Generate candidates: each customer is a candidate
    candidates = []
    
    for idx, row in df_clustering.iterrows():
        # Base score: customer_score from clustering
        base_score = row['customer_score']
        
        # Apply rule-based multipliers
        # High-value clusters get bonus
        cluster_bonus = 1.0
        if row['cluster_size'] > df_clustering['cluster_size'].median():
            cluster_bonus = 1.1
        
        # Apply rule confidence as score multiplier
        rule_multiplier = rule_stats['avg_confidence']
        
        # Calculate priority_score (0-1 range)
        priority_score = (base_score / 100) * cluster_bonus * rule_multiplier
        priority_score = min(priority_score, 1.0)
        
        candidate = {
            'candidate_id': row['customer_id'],
            'cluster_id': int(row['cluster_id']),
            'customer_score': round(row['customer_score'], 2),
            'priority_score': round(priority_score, 2),
            'product_category': row['product_category'],
            'region': row['region'],
            'purchase_frequency': int(row['purchase_frequency']),
            'avg_order_value': round(row['avg_order_value'], 2),
            'days_since_last_purchase': int(row['days_since_last_purchase']),
            'status': 'pending_review',
            'created_at': pd.Timestamp.now().isoformat(),
        }
        candidates.append(candidate)
    
    # Convert to DataFrame and sort by priority_score descending
    df_candidates = pd.DataFrame(candidates)
    df_candidates = df_candidates.sort_values('priority_score', ascending=False).reset_index(drop=True)
    
    # Save to CSV
    if output_file is None:
        output_file = Path(clustering_output_path).parent / "candidate_snapshot.csv"
    
    df_candidates.to_csv(output_file, index=False)
    
    print(f"✓ Generated {len(df_candidates)} candidates")
    print(f"  Output file: {output_file}")
    print(f"  Priority score range: {df_candidates['priority_score'].min():.2f} - {df_candidates['priority_score'].max():.2f}")
    print(f"\nTop 10 candidates by priority_score:")
    print(df_candidates.head(10)[['candidate_id', 'priority_score', 'cluster_id', 'product_category']])
    
    return output_file

if __name__ == "__main__":
    clustering_file = Path(__file__).parent.parent / "data" / "clustering_output.csv"
    
    if not clustering_file.exists():
        print(f"Error: {clustering_file} not found")
        exit(1)
    
    generate_candidates(str(clustering_file))
