#!/usr/bin/env python3
"""
Phase14 Dummy Data Generation
Generates clustering_output.csv with synthetic customer data.
"""

import os
import pandas as pd
import numpy as np
from pathlib import Path

def generate_dummy_data():
    """Generate synthetic clustering output for Phase14."""
    
    # Create data directory if it doesn't exist
    data_dir = Path(__file__).parent.parent / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    
    # Set random seed for reproducibility
    np.random.seed(42)
    
    # Generate synthetic customer data
    n_samples = 100
    
    customers = {
        'customer_id': [f'CUST_{i:04d}' for i in range(n_samples)],
        'purchase_frequency': np.random.randint(1, 50, n_samples),
        'avg_order_value': np.random.uniform(50, 500, n_samples),
        'days_since_last_purchase': np.random.randint(1, 365, n_samples),
        'product_category': np.random.choice(['Electronics', 'Clothing', 'Books', 'Home', 'Sports'], n_samples),
        'region': np.random.choice(['US', 'EU', 'APAC', 'LATAM'], n_samples),
    }
    
    df_customers = pd.DataFrame(customers)
    
    # Generate clustering assignment (simulate HDBSCAN output)
    n_clusters = 5
    df_customers['cluster_id'] = np.random.choice(range(n_clusters), n_samples)
    df_customers['cluster_size'] = df_customers.groupby('cluster_id')['cluster_id'].transform('size')
    
    # Calculate a simple score for each customer (basis for later candidate ranking)
    df_customers['customer_score'] = (
        df_customers['purchase_frequency'] * 0.4 +
        df_customers['avg_order_value'] / 100 * 0.3 +
        (365 - df_customers['days_since_last_purchase']) / 365 * 100 * 0.3
    )
    
    # Save clustering output
    output_file = data_dir / "clustering_output.csv"
    df_customers.to_csv(output_file, index=False)
    
    print(f"✓ Generated clustering_output.csv with {n_samples} samples")
    print(f"  Clusters: {n_clusters}")
    print(f"  Output file: {output_file}")
    print(f"\nData preview:")
    print(df_customers.head())
    
    return output_file

if __name__ == "__main__":
    generate_dummy_data()
