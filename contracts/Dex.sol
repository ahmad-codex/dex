// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/utils/math/SafeMath.sol';
//use SafeMath library (solidity library) to handle integer overflow

contract Dex {
    using SafeMath for uint;

    enum Side {
        BUY,
        SELL
    }

    //create token registry
    //define a struct to represent a token
    struct Token {
        bytes32 ticker;
        address tokenAddress;
    }

    struct Order {
        uint id;
        address trader;
        Side side;
        bytes32 ticker;
        uint amount;
        uint filled;
        uint price;
        uint date;
    }

    //need to represent the collection of our token
    mapping(bytes32 => Token) public tokens;

    //to have the ability to iterate through all the tokens we also need to have a list of all the tickers
    bytes32[] public tokenList;
    mapping(address => mapping(bytes32 => uint)) public traderBalances;
    
    //need to keep orders in collection, and this is the purpose of the orderbook (the orderbook is indexed by token)
    mapping(bytes32 => mapping(uint => Order[])) public orderBook; 
    //orders array is sorted by the best price in the beginning and then age (for matching orders)
    //example for buy orders: [50, 45, 44, 30] highest price to lowest
    //example for sell orders: [60, 67, 70, 72]

    address public admin;//admin is the creator of the smart contract
    uint public nextOrderId;//to keep track of the current order
    uint public nextTradeId;
    bytes32 constant DAI = bytes32('DAI');

    //create new trade event because the output of the order matching algorithm is a new trade
    event NewTrade(
        uint tradeId,
        uint orderId,//reference to order
        bytes32 indexed ticker,//reference to the token
        address indexed trader1,//reference to the two traders
        address indexed trader2,
        uint amount,
        uint price,
        uint date
    );

    constructor() {
        admin = msg.sender;
    }

    function getOrders(
        bytes32 ticker,
        Side side)
        external
        view
        returns(Order[] memory) {
        return orderBook[ticker][uint(side)];
    }

    function getTokens() 
      external 
      view 
      returns(Token[] memory) {
      Token[] memory _tokens = new Token[](tokenList.length);
      for (uint i = 0; i < tokenList.length; i++) {
        _tokens[i] = Token(
          tokens[tokenList[i]].ticker,
          tokens[tokenList[i]].tokenAddress
        );
      }
      return _tokens;
    }

    function addToken(bytes32 _ticker, address _tokenAddress) external onlyAdmin {
        tokens[_ticker] = Token(_ticker, _tokenAddress);
        tokenList.push(_ticker);
    }

    //wallet features: deposit & withdraw tokens
    //deposit ERC20 token to the DEX smart contract
    function deposit(
        uint amount, 
        bytes32 ticker) 
        external
        tokenExist(ticker) {
        IERC20(tokens[ticker].tokenAddress).transferFrom(
            msg.sender,
            address(this),
            amount
        );
        //traderBalances[msg.sender][ticker] += amount;
        //use SafeMath increment instead to handle integer overflow
        traderBalances[msg.sender][ticker] = traderBalances[msg.sender][ticker].add(amount);
    }
    
    function withdraw(
        uint amount,
        bytes32 ticker)
        external
        tokenExist(ticker) {
        require(
            traderBalances[msg.sender][ticker] >= amount,
            'balance too low'
        );
        //traderBalances[msg.sender][ticker] -= amount;
        traderBalances[msg.sender][ticker] = traderBalances[msg.sender][ticker].sub(amount);
        IERC20(tokens[ticker].tokenAddress).transfer(msg.sender, amount);        
    }

    function createLimitOrder(
        bytes32 ticker,
        uint amount,
        uint price,
        Side side)
        tokenExist(ticker)
        tokenIsNotDai(ticker)
        external {
        //check the balance of the trader if enough to trade
        if(side == Side.SELL) {
            require(
                traderBalances[msg.sender][ticker] >= amount,
                'token balance too low'
            );
        } else {
            //check DAI balance if enough to buy the amount of token
            require(
                traderBalances[msg.sender][DAI] >= amount.mul(price), //amount * price,
                'dai balance too low'
            );            
        }
        //we need a pointer to the orders array in the orderbook
        Order[] storage orders = orderBook[ticker][uint(side)];
        orders.push(Order(
            nextOrderId,
            msg.sender,
            side,
            ticker,
            amount,
            0,
            price,
            block.timestamp
        ));
        //here we have problem, we need to keep the sorting of the orders based on the best price for the orders matching
        //we will assume the order is correct of the array and will use the bubble sort algorithm
        //compare the last element with previous one and swap if not in order and so on
        uint i = orders.length > 0 ? orders.length - 1 : 0;
        while(i > 0) {
            //stopping conditions
            if(side == Side.BUY && orders[i - 1].price > orders[i].price) {
                break;
            }
            if(side == Side.SELL && orders[i - 1].price < orders[i].price) {
                break;
            }
            //otherwise, swap the elements
            Order memory order = orders[i - 1];
            orders[i - 1] = orders[i];
            orders[i] = order;
            //i--;
            i = i.sub(1);
        }
        //nextOrderId++;
        nextOrderId = nextOrderId.add(1);
    }

    //need to implement the market orders and the order matching algorithm
    function createMarketOrder(
        bytes32 ticker,
        uint amount,
        Side side) 
        tokenExist(ticker)
        tokenIsNotDai(ticker)
        external {
        if(side == Side.SELL) {
            require(
                traderBalances[msg.sender][ticker] >= amount,
                'token balance too low'
            );
        }
        Order[] storage orders = orderBook[ticker][uint(side == Side.BUY ? Side.SELL : Side.BUY)];
        uint i;//for iterations
        uint remaining = amount;

        while(i < orders.length && remaining > 0) {
            //check the liquidity of each order (available amount)
            //uint available = orders[i].amount - orders[i].filled;
            uint available = orders[i].amount.sub(orders[i].filled);
            uint matched = remaining > available ? available : remaining;
            //remaining -= matched;
            remaining = remaining.sub(matched);
            //orders[i].filled += matched;
            orders[i].filled = orders[i].filled.add(matched);
            emit NewTrade(
                nextTradeId,
                orders[i].id,
                ticker,
                orders[i].trader,//trader who created the limit order in the orderbook
                msg.sender,//trader who created the market order
                matched,
                orders[i].price,
                block.timestamp
            );
            //now we need to update the token balance for the two traders
            if(side == Side.SELL) {
                // traderBalances[msg.sender][ticker] -= matched;
                // traderBalances[msg.sender][DAI] += matched * orders[i].price;
                // traderBalances[orders[i].trader][ticker] += matched;
                // traderBalances[orders[i].trader][DAI] -= matched * orders[i].price;
                traderBalances[msg.sender][ticker] = traderBalances[msg.sender][ticker]
                    .sub(matched);
                traderBalances[msg.sender][DAI] = traderBalances[msg.sender][DAI]
                    .add(matched.mul(orders[i].price));
                traderBalances[orders[i].trader][ticker] = traderBalances[orders[i].trader][ticker]
                    .add(matched);
                traderBalances[orders[i].trader][DAI] = traderBalances[orders[i].trader][DAI]
                    .sub(matched.mul(orders[i].price));
            }
            if(side == Side.BUY) {
                //validate DAI balance if enough to buy this amount of token
                //the whole transaction will revert if failed
                require(
                    traderBalances[msg.sender][DAI] >= matched.mul(orders[i].price),
                    'dai balance too low'
                );
                traderBalances[msg.sender][ticker] = traderBalances[msg.sender][ticker]
                    .add(matched);
                traderBalances[msg.sender][DAI] = traderBalances[msg.sender][DAI]
                    .sub(matched.mul(orders[i].price));
                traderBalances[orders[i].trader][ticker] = traderBalances[orders[i].trader][ticker]
                    .sub(matched);
                traderBalances[orders[i].trader][DAI] = traderBalances[orders[i].trader][DAI]
                    .add(matched.mul(orders[i].price));
            }
            nextTradeId = nextTradeId.add(1);
            i = i.add(1);
        }

        //need to remove the filled orders from the orderbook as it will become huge over time
        i = 0;
        while(i < orders.length && orders[i].filled == orders[i].amount) {
            for(uint j = i; j < orders.length - 1; j++) {
                orders[j] = orders[j + 1];
            }
            orders.pop();
            i = i.add(1);
        }
    }

    modifier tokenIsNotDai(bytes32 ticker) {
        //must not allow to trade the quote token
        require(ticker != DAI, 'cannot trade DAI');
        _;
    }

    modifier tokenExist(bytes32 ticker) {
        require(
            tokens[ticker].tokenAddress != address(0),
            'this token does not exist'
        );
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, 'Only admin');
        _;
    }
}