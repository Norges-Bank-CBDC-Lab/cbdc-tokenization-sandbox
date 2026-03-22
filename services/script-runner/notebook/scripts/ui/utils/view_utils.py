def get_allowlist_html(allowlist, show_name_column=True):
    """Create consistent HTML style allowlist table"""
    style_html = """
    <style>
        table {
            border-collapse: collapse;
            width: 100%;
            font-family: Arial, sans-serif;
        }
    </style>
    """
    html = f"""
    {style_html}
    <table>
        <tr style='text-align: left;'>
            { "<th>Name</th>" if show_name_column else ""}
            <th>Address</th>
        </tr>
    """
    for entry in allowlist:
        name = entry["name"]
        address = entry["address"]
        html += f"""
        <tr>
            { f"<td>{name}</td>" if show_name_column else ""}
            <td>{address}</td>
        </tr>
        """
    html += "</table>"
    return html


def get_balances_html(entity, root_dns_zone, show_name_column=True):
    """Create consistent HTML style balances table"""
    style_html = """
    <style>
        table {
            border-collapse: collapse;
            width: 100%;
            font-family: Arial, sans-serif;
        }
        a.button {
            display: inline-block;
            color: black;
            background-color: #EEEEEE;
            padding: 1px 15px;
            text-align: center;
            text-decoration: none;
            border-radius: 5px;
            border: none;
            font-size: 14px;
        }
        a.button:hover {
            background-color: #DDDDDD;
        }
    </style>
    """
    html = f"""
    {style_html}
    <table>
        <tr style='text-align: left;'>
            { "<th>Name</th>" if show_name_column else ""}
            <th>Address</th>
            <th>Balance</th>
            <th></th>
        </tr>
    """
    for ent in entity:
        name, address, balance = ent
        hlink = f"http://blockscout.{root_dns_zone}/address/{address}"
        html += f"""
        <tr>
            { f"<td>{name}</td>" if show_name_column else ""}
            <td>{address}</td>
            <td>{balance}</td>
            <td><a href="{hlink}" target="_blank" class="button">View Details</a></td>
        </tr>
        """
    html += "</table>"
    return html


def get_listings_html(listings, root_dns_zone):
    """Create consistent HTML style listings table"""
    style_html = """
    <style>
        table {
            border-collapse: collapse;
            width: 100%;
            font-family: Arial, sans-serif;
        }
        a.button {
            display: inline-block;
            color: black;
            background-color: #EEEEEE; /* Bootstrap blue color */
            padding: 1px 15px;
            text-align: center;
            text-decoration: none;
            border-radius: 5px;
            border: none;
            font-size: 14px;
        }
        a.button:hover {
            background-color: #DDDDDD; /* Darker shade on hover */
        }
    </style>
    """
    html = f"""{style_html}
    <table>
        <tr style='text-align: left;'>
            <th>Name</th>
            <th>Symbol</th>
            <th>Volume</th>
            <th>ISIN</th>
            <th>Issuer</th>
            <th>Description</th>
            <th></th>
        </tr>
    """
    for listing in listings:
        name = listing["name"]
        symbol = listing["symbol"]
        total_supply = listing["total_supply"]
        isin = listing["isin"]
        issuer_name = listing["issuer_name"]
        description = listing["description"]
        address = listing["address"]
        hlink = f"http://blockscout.{root_dns_zone}/address/{address}"
        html += f"""
        <tr>
            <td>{name}</td>
            <td>{symbol}</td>
            <td>{total_supply}</td>
            <td>{isin}</td>
            <td>{issuer_name}</td>
            <td>{description}</td>
            <td><a href="{hlink}" target="_blank" class="button">View Details</a></td>
        </tr>
        """
    html += "</table>"
    return html


def get_order_book_html(bids, asks):
    """Create consistent HTML style order book table"""
    style_html = """
    <style>
        .bid-row:hover {
            background-color: #d4f0d4;
        }
        .ask-row:hover {
            background-color: #f0d4d4;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            font-family: Arial, sans-serif;
        }
        .bold-price {
            font-weight: bold;
        }
    </style>
    """

    bid_rows_html = "".join(
        f"""
        <tr class='bid-row' style='background-color: #e6ffe6;'>
            <td style='color: green; border: 1px solid #e6ffe6; width: 25%;
                {"font-weight: bold;" if i == len(bids) - 1 else ""}'>{bid['price']}</td>
            <td style='border: 1px solid #e6ffe6; width: 25%'>{bid['amount']}</td>
            <td style='border: 1px solid #e6ffe6; width: 25%'>{bid['market_participant']}</td>
        </tr>
        """
        for i, bid in enumerate(bids)
    )

    ask_rows_html = "".join(
        f"""
        <tr class='ask-row' style='background-color: #ffe6e6; border: none;'>
            <td style='color: red; border: 1px solid #ffe6e6; width: 25%;
                {"font-weight: bold;" if i == 0 else ""}'>{ask['price']}</td>
            <td style='border: 1px solid #ffe6e6; width: 25%;'>{ask['amount']}</td>
            <td style='border: 1px solid #ffe6e6; width: 25%'>{ask['market_participant']}</td>
        </tr>
        """
        for i, ask in enumerate(asks)
    )

    rows_html = bid_rows_html + ask_rows_html

    return f"""
    {style_html}
    <table>
        <tr style='text-align: left;'>
            <th>Price [NOK]</th>
            <th>Size</th>
            <th>Market Participant</th>
        </tr>
        {rows_html}
    </table>
    """


def get_customer_orders_html(buy_orders, sell_orders):
    """Create consistent HTML style open account orders table"""
    style_html = """
    <style>
        table {
            border-collapse: collapse;
            width: 100%;
            font-family: Arial, sans-serif;
        }
    </style>
    """

    buy_rows_html = "".join(
        f"""
    <tr>
        <td style=width: 25%;'>{order['id_hex']}</td>
        <td style=width: 25%;'>{order['type']}</td>
        <td style=width: 25%;'>{order['size']}</td>
        <td style=width: 25%;'>{order['price']}</td>
    </tr>
    """
        for order in buy_orders
    )

    sell_rows_html = "".join(
        f"""
    <tr>
        <td style=width: 25%;'>{order['id_hex']}</td>
        <td style=width: 25%;'>{order['type']}</td>
        <td style=width: 25%;'>{order['size']}</td>
        <td style=width: 25%;'>{order['price']}</td>
    </tr>
    """
        for order in sell_orders
    )

    rows_html = buy_rows_html + sell_rows_html

    return f"""
    {style_html}
    <table>
        <tr style='text-align: left;'>
            <th>ID</th>
            <th>Type</th>
            <th>Size</th>
            <th>Price [NOK]</th>
        </tr>
        {rows_html}
    </table>
    """


def get_trade_history_html(trade_history_filtered, selected_investor_address):
    """Generate HTML styled trade history table based on the current address provided."""
    if trade_history_filtered is None or len(trade_history_filtered) == 0:
        return (
            "<p>No trade history available. Please note: contracts have to be deployed "
            "using --verify, and blockscout must be running to see a trade history.</p>"
        )
    style_html = """
    <style>
        table {
            border-collapse: collapse;
            width: 100%;
            font-family: Arial, sans-serif;
        }
    </style>
    """

    rows_html = ""

    for trade in trade_history_filtered:
        # Add both 'sell' and 'buy' entries if buyer == seller
        if (
            trade["sellerSecAddr"] == trade["buyerSecAddr"]
            and trade["sellerSecAddr"] == selected_investor_address
        ):
            rows_html += f"""
            <tr>
                <td style='width: 25%;'>sell</td>
                <td style='width: 25%;'>1</td>
                <td style='width: 25%;'>{trade['wholesaleValue']}</td>
                <td style='width: 25%;'>{trade['timestamp']}</td>
            </tr>
            <tr>
                <td style='width: 25%;'>buy</td>
                <td style='width: 25%;'>1</td>
                <td style='width: 25%;'>{trade['wholesaleValue']}</td>
                <td style='width: 25%;'>{trade['timestamp']}</td>
            </tr>
            """
        else:
            if trade["sellerSecAddr"] == selected_investor_address:
                transaction_type = "sell"
            elif trade["buyerSecAddr"] == selected_investor_address:
                transaction_type = "buy"
            else:
                continue  # Skip trades not involving the selected investor
            rows_html += f"""
            <tr>
                <td style='width: 25%;'>{transaction_type}</td>
                <td style='width: 25%;'>1</td>
                <td style='width: 25%;'>{trade['wholesaleValue']}</td>
                <td style='width: 25%;'>{trade['timestamp']}</td>
            </tr>
            """

    return f"""
    {style_html}
    <table>
        <tr style='text-align: left;'>
            <th>Type</th>
            <th>Size</th>
            <th>Price [NOK]</th>
            <th>Timestamp</th>
        </tr>
        {rows_html}
    </table>
    """
