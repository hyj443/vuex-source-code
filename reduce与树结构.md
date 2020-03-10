# 阅读 Vuex 源码引发的 reduce 与 树结构 的思考

## 遇到的问题

在看 Vuex 源码的时候，发现了一个用reduce构建树结构的做法，自己看不太明白。

想做的是这样的，用户传store配置项的时候，可能会写modules，然后module对象下又可能嵌套modules：

```js
const store = new Vuex.Store({
  state: { /***/ },
  mutations: { /***/ },
  modules: {
    a: {
      state: { /***/ },
      mutations: { /***/ },
      modules: {
        a_1: {
          state: { /***/ },
          mutations: { /***/ },
          modules: {
            a_1_1: {
              state: { /***/ },
              mutations: { /***/ }
            }
          }
        }
      }
    },
    b: moduleB
  }
})
```

现在要做 module 的收集和注册，定义了一个register函数（相较于Vuex中的做了简化）
register是ModuleCollection类的原型方法，它里面的this指向这个类的实例

```js
class ModuleCollection {
  constructor(rawRootModule) {
    this.register([], rawRootModule)
  }
  register(path, rawModule) {
    let newModule = { // 定义了模块对象，它有_children属性
      _rawModule = rawModule,
      _children: {},
      state: rawModule.state
    }
    if (path.length === 0) { // []代表是根模块，类似['a']，['a','a1']这种是子模块
      this.root = newModule
    } else { // 当前是子模块，要更新它的父模块对象的_children，建立父子关系

      // path.slice(0,-1) 就是父模块的path，根据 path 找到父模块 parent

      let parent = path.slice(0, -1).reduce((module, key) => { // 当时这里没搞懂
        return module._children[key]
      }, this.root)

      parent._children[path[path.length - 1]] = newModule // 在父模块对象增加子模块对象属性
    }
    if (rawModule.modules) { // 当前模块有子模块嵌套，遍历modules的键值对，递归调用register
      Object.keys(rawModule.modules).forEach(key => {
        this.register(path.concat(key), rawModule.modules[key])
      })
    }
  }
}
```

不理解的原因是对 reduce 方法的生疏

回顾一下reduce方法：
接收两个参数：1、reducer 回调函数，2、initialValue 累加器初始值（它是可选的）

第一个参数，回调函数，接收4个参数：累加器、当前遍历的元素、当前遍历的元素索引、被遍历的数组本身

第二个参数，“累加器的初始值”，也就是，第一个执行回调时的第一个参数（累加器）的值。如果没传这个初始值，数组的第一个元素就会作为初始值，reduce 会从第二个元素开始遍历并执行回调。如果提供了初始值，则从第一个元素开始遍历并执行回调。

怎么理解这个累加器？
如果提供了累加器初始值，那它最开始就是等于这个初始值
执行了一次回调了之后，它就等于回调执行的返回值，以后每次回调的返回值都赋给它，所以累加器是上一次迭代执行回调时的返回值。

```js
let parent = path.slice(0, -1).reduce((module, key) => {
  return module._children[key]
}, this.root)
```

我们知道 path 是当前模块的 path ，path.slice(0, -1) 是它的父模块的 path ，但父模块不一定是根模块，我们现在只知道根模块的对象，我们要找沿着这个 path ，去找根模块的子模块，子模块的子模块，直到当前模块的父模块。

假设当前 path 是 [1,2,3,4]，path.slice(0, -1) 就是 [1,2,3]
因为提供了this.root这个累加器的初始值，reduce 从第 1 个元素开始执行回调，返回this.root._children[1]，下一次执行回调就返回 this.root._children[1]._children[2]，再下一次返回 this.root._children[1]._children[2]._children[3]，所以我们得到了[1,2,3]这个path的模块对象，也就是[1,2,3,4]这个path的模块的父模块对象。

这种树形结构，每一条path，对应一个对象，要想构建父子关系，就必须给父对象的children增加属性，已知有根父对象，和一条已知的path，并且这条path不为空数组，说明根对象有 _children ，通过数组方法reduce，沿着 父path 数组，累加器每次取 _children 并作为下一次回调的累加器，就能返回出 该path的父对象。

> 将下面这个多维具有嵌套关系的数组 转成 一维的扁平化数组

```js
[
  {
    'Name': '广东省',
    'PId': '0',
    'Id': '1',
    'children': [
      {
        'Name': '广州市',
        'PId': '1',
        'Id': '3',
        'children': [
          {
            'Name': '荔湾区',
            'PId': '3',
            'Id': '6'
          }
        ]
      },
      {
        'Name': '惠州市',
        'PId': '1',
        'Id': '4'
      }
    ]
  },
  {
    'Name': '台湾省',
    'PId': '0',
    'Id': '2',
    'children': [
      {
        'Name': '台北市',
        'PId': '2',
        'Id': '5'
      }
    ]
  }
]
```

> 怎么转成下面这种 扁平化 格式：

```js
[
  {
    'Name': '广东省',
    'PId': '0',
    'Id': '1'
  },
  {
    'Name': '广州市',
    'PId': '1',
    'Id': '3'
  },
  {
    'Name': '荔湾区',
    'PId': '2',
    'Id': '6'
  },
  {
    'Name': '惠州市',
    'PId': '1',
    'Id': '4'
  },
  {
    'Name': '台湾省',
    'PId': '0',
    'Id': '2'
  },
  {
    'Name': '台北市',
    'PId': '2',
    'Id': '5'
  }
]
```

思路，把数组中元素的children属性值给展平了，递归调用flatten函数，可以使用reduce 累加 并concat 组成最后的扁平数组

```js
function flatten(data) {
  return data.reduce((prev, { Name, PId, Id, children = [] }) => {
    return prev.concat({ Name, PId, Id })
      .concat(flatten(children))
  }, [])
}
```

这里用到了解构赋值，从当前遍历的元素对象解构出同名变量，再塞到一个新对象中，并concat到累加器，同时concat children数组展平后的值，如果没有children就默认为空数组。


如果我们把第一维的元素对象，添加一个level属性为1，二维的元素对象level为2，以此类推

```js
function flatten(data, level = 1) {
  return data.reduce((prev, { Name, Pid, id, children = [] }) => {
    return prev.concat({ Name, Pid, id, level }).concat(flatten(children, level+1))
  }, [])
}
```


Vuex 2.x版本添加了命名空间的功能，使用了module后，state就被模块化，比如要获取根模块的state，则`store.state.xxx`，如果要获取a模块的state，则调用`store.state.a.xxx`。

但默认情况下，模块内部的 action、mutation 和 getter 是注册在全局命名空间的，比如，不同模块有同名的mutation，会导致多个模块能够对同一个 mutation 作出响应。

如果希望你的模块具有更高的封装度和复用性，你可以通过添加 namespaced: true 的方式使其成为带命名空间的模块。当模块被注册后，它的所有 getter、action 及 mutation 都会自动根据模块注册的路径调整命名。

启用了命名空间的 getter 和 action 会收到局部化的 getter，dispatch 和 commit。换言之，你在使用模块内容（module assets）时不需要在同一模块内额外添加空间名前缀。更改 namespaced 属性后不需要修改模块内的代码。

#在带命名空间的模块内访问全局内容（Global Assets）
如果你希望使用全局 state 和 getter，rootState 和 rootGetters 会作为第三和第四参数传入 getter，也会通过 context 对象的属性传入 action。

若需要在全局命名空间内分发 action 或提交 mutation，将 { root: true } 作为第三参数传给 dispatch 或 commit 即可。
我们看installModule的实现：


由 Vuex 文档可知：

Vuex 使用了 module 后，state 就被模块化，比如读取根模块的 state：`store.state.xxx`，如果要读取 a 模块的 state：`store.state.a.xxx`。

默认情况下，模块内部的 action、mutation 和 getter 是会注册在全局命名空间的。如果不同模块有同名的 mutation，会导致这些模块能够对同一个 mutation 作出响应。

如果希望你的模块具有更高的封装度和复用性，你可以通过添加 namespaced: true 的方式，使其成为带“命名空间”的模块。当模块被注册后，它的所有 getter、action 及 mutation 都会自动根据模块注册的路径调整命名。例如：

```js
const store = new Vuex.Store({
  modules: {
    account: {
      namespaced: true,
      state: {}, 
      getters: {
        isAdmin() {...} // -> getters['account/isAdmin']
      },
      actions: {
        login() {...} // -> dispatch('account/login')
      },
      mutations: {
        login() {...} // -> commit('account/login')
      },
      modules: { // 继承父模块的命名空间
        myPage: {
          state: {},
          getters: {
            profile() {...} // -> getters['account/profile']
          }
        },
        posts: {
          namespaced: true,// 进一步嵌套命名空间
          state: {},
          getters: {
            popular() {...} // -> getters['account/posts/popular']
          }
        }
      }
    }
  }
})
```



```js
const store = new Vuex.Store({
  state:{
    a:1
  }
  mutations: {
    change(state) {
      state.a++
    }
  }
})
```
这其实就像注册事件的回调函数：你调用 store.commit 触发 type 为 "change" 的 mutation 时，会触发它的 handler 回调。注意，你不能直接调用 mutation 的 handler。

commit 是 Store 构造函数的原型方法，用户调用 commit 提交 mutation 有不同的传参方式，比如：
```js
store.commit('change') // 传 mutation 的 type 字符串

store.commit({ // 传一个包含 type 的对象
  type:'change',
  amount: 10
})

```